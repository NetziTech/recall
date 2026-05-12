import type { Clock } from "../../../../shared/application/ports/clock.port.ts";
import type { Logger } from "../../../../shared/application/ports/logger.port.ts";
import { Confidence } from "../../../../shared/domain/value-objects/confidence.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { CuratorRunRepository } from "../../domain/repositories/curator-run-repository.ts";
import type { PrunedEntryRepository } from "../../domain/repositories/pruned-entry-repository.ts";
import type { CuratorRunId } from "../../domain/value-objects/curator-run-id.ts";
import { MemoryEntryKind } from "../../domain/value-objects/memory-entry-kind.ts";
import { PrunedEntry } from "../../domain/value-objects/pruned-entry.ts";
import { PrunedReason } from "../../domain/value-objects/pruned-reason.ts";
import { PruneThreshold } from "../../domain/value-objects/prune-threshold.ts";
import { CuratorApplicationError } from "../errors/curator-application-error.ts";
import type {
  PruneLowConfidence,
  PruneLowConfidenceResult,
} from "../ports/in/prune-low-confidence.port.ts";
import type { MemoryEntryReader } from "../ports/out/memory-entry-reader.port.ts";
import type { MemoryEntryWriter } from "../ports/out/memory-entry-writer.port.ts";

/**
 * Number of milliseconds in 30 days. The prune predicate requires
 * `created_at_ms <= now - 30 days` (`docs/05-memoria-decay.md` §4).
 * Pre-computed at module-load time.
 */
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The kinds the curator is allowed to auto-prune. Per
 * `docs/05-memoria-decay.md` §4:
 *
 * > Equivalente para `turns`. Para `entities` y `decisions` solo si
 * > fueron explicitamente marcadas obsoletas.
 *
 * `task` is excluded because the curator does not track its open/done
 * status separately — auto-pruning a `task (open)` would silently
 * lose work the user still cares about. The MVP keeps the kind out
 * of the auto-prune loop entirely.
 */
const AUTO_PRUNEABLE_KINDS = [
  MemoryEntryKind.learning(),
  MemoryEntryKind.turn(),
] as const;

/**
 * Use case: drop low-confidence entries from the live tables.
 *
 * Implements the `PruneLowConfidence` driving port. For each
 * pruneable kind, finds candidates matching the spec triple
 * (confidence < threshold, use_count == 0, createdAt <= now - 30 days)
 * via a SINGLE SQL query in the reader, snapshots them to `pruned`,
 * deletes the live row, and records `EntryPruned` events on the
 * active `CuratorRun`.
 *
 * Why a single SQL query instead of per-row decisions:
 * - The predicates are fixed (no per-entry logic), so the application
 *   layer would just enumerate every row and re-check the same
 *   conditions. Pushing them down to SQL is one order of magnitude
 *   faster on a 50K-entry workspace.
 * - The reader's `listPruneCandidates(...)` returns a bounded set
 *   (only pruneable rows), so the use case never holds more than the
 *   actual prune set in memory.
 *
 * Idempotency: the second call's reader returns an empty set (the
 * first call already removed the candidates). The writer's
 * `markPruned(...)` is also idempotent at the row level.
 *
 * Snapshot content: the projection's `contentSnapshot` field carries
 * the JSON-serialised form of the row (the reader assembles it). The
 * use case stores it verbatim in the `pruned.content_snapshot`
 * column; the curator's domain treats the snapshot opaquely.
 */
export class PruneLowConfidenceUseCase implements PruneLowConfidence {
  public constructor(
    private readonly reader: MemoryEntryReader,
    private readonly writer: MemoryEntryWriter,
    private readonly prunedRepo: PrunedEntryRepository,
    private readonly curatorRuns: CuratorRunRepository,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  public async prune(input: {
    runId: CuratorRunId;
    workspaceId: WorkspaceId;
    threshold?: PruneThreshold;
  }): Promise<PruneLowConfidenceResult> {
    const threshold = input.threshold ?? PruneThreshold.default();
    const cutoffMs = this.clock.nowMs() - THIRTY_DAYS_MS;

    const candidates = await this.reader.listPruneCandidates({
      workspaceId: input.workspaceId,
      pruneableKinds: AUTO_PRUNEABLE_KINDS,
      confidenceBelow: Confidence.of(threshold.toNumber()),
      cutoffMs,
    });

    if (candidates.length === 0) {
      return {
        runId: input.runId,
        entriesPruned: 0,
      };
    }

    const run = await this.curatorRuns.findById(input.runId);
    if (run === null) {
      throw CuratorApplicationError.runNotFound(input.runId.toString());
    }

    const occurredAt = this.clock.now();
    const reason = PrunedReason.lowConfidence();
    let entriesPruned = 0;

    // Performance (W-3.4-PERF-H2 closure): batch ALL candidates into
    // a single SQL transaction via the writer's `markPrunedBatch`.
    // Prior implementation issued one transaction per candidate
    // (1 fsync each), which scaled linearly with candidate count —
    // dominant cost for workspaces >10k entries. The batch wraps
    // every (INSERT into pruned, DELETE from live) pair plus the
    // domain-event emissions in a single SQLite transaction.
    //
    // Domain-event correctness: the writer returns a boolean mask
    // parallel to the input array (`wasPrunedMask[i] === true` iff
    // candidate i was actually deleted). We use the mask to drive
    // `run.recordPrune(...)` only for the rows that survived the
    // idempotency check — matching the per-row semantics of the
    // previous loop.
    const writerInputs = candidates.map((candidate) => ({
      kind: candidate.kind,
      entryId: candidate.id,
      contentSnapshot: candidate.contentSnapshot,
      reasonKind: "low_confidence" as const,
      prunedAt: occurredAt,
    }));

    // Persist the pruned-entry snapshots first so the audit trail
    // exists even if the writer's batch throws mid-way. The
    // `prunedRepo.save(...)` calls are still per-row because the
    // repository contract is append-only and the pruned table has a
    // PK on (workspace, kind, id); a single failure should not roll
    // back the entire batch of audit snapshots. (If `prunedRepo`
    // grows a `saveBatch` in the future, this loop folds into it.)
    for (const candidate of candidates) {
      const snapshot = PrunedEntry.create({
        workspaceId: candidate.workspaceId,
        kind: candidate.kind,
        originalId: candidate.id,
        contentSnapshot: candidate.contentSnapshot,
        reason,
        prunedAt: occurredAt,
      });
      await this.prunedRepo.save(snapshot);
    }

    const wasPrunedMask = await this.writer.markPrunedBatch({
      workspaceId: input.workspaceId,
      items: writerInputs,
    });

    for (let i = 0; i < candidates.length; i += 1) {
      if (wasPrunedMask[i] !== true) continue;
      const candidate = candidates[i];
      /* istanbul ignore if -- defensive: candidates and wasPrunedMask are parallel arrays of identical length; undefined only reachable via misuse. */
      if (candidate === undefined) continue;
      run.recordPrune({
        kind: candidate.kind,
        originalId: candidate.id,
        reason,
        occurredAt,
      });
      entriesPruned += 1;
    }

    if (entriesPruned > 0) {
      await this.curatorRuns.save(run);
    }

    this.logger.debug(
      {
        runId: input.runId.toString(),
        workspaceId: input.workspaceId.toString(),
        candidates: candidates.length,
        entriesPruned,
      },
      "curator: prune pass completed",
    );

    return {
      runId: input.runId,
      entriesPruned,
    };
  }
}
