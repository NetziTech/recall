import type { Clock } from "../../../../shared/application/ports/clock.port.ts";
import type { Logger } from "../../../../shared/application/ports/logger.port.ts";
import type { Confidence } from "../../../../shared/domain/value-objects/confidence.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import { DecayCalculator } from "../../domain/services/decay-calculator.ts";
import type { CuratorRunId } from "../../domain/value-objects/curator-run-id.ts";
import { MemoryEntryKind } from "../../domain/value-objects/memory-entry-kind.ts";
import type {
  ApplyDecay,
  ApplyDecayResult,
} from "../ports/in/apply-decay.port.ts";
import type {
  MemoryEntryProjection,
  MemoryEntryReader,
} from "../ports/out/memory-entry-reader.port.ts";
import type { MemoryEntryWriter } from "../ports/out/memory-entry-writer.port.ts";

interface PendingDecay {
  readonly kind: MemoryEntryKind;
  readonly entryId: string;
  readonly newConfidence: Confidence;
}

/**
 * Number of milliseconds in a day. Pre-computed at module-load time so
 * the per-entry hot path stays free of `24 * 3600 * 1000` arithmetic
 * (a constant the V8 JIT inlines, but explicit naming clarifies
 * intent at the call site).
 */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Use case: apply geometric decay to every active memory entry.
 *
 * Implements the `ApplyDecay` driving port. Drives the pure
 * `DecayCalculator` domain service across every kind in
 * `MemoryEntryKind.all()`, persists each change through
 * `MemoryEntryWriter.applyDecay(...)`, and returns the counters the
 * orchestrator folds into `CuratorRunStats`.
 *
 * Why a class (not a free function):
 * - The composition root injects `MemoryEntryReader`,
 *   `MemoryEntryWriter`, `Clock` and `Logger` exactly once at server
 *   start-up. A function would force every caller to plumb four
 *   arguments.
 *
 * Phase separation (Bug F fix — Tarea 5.4):
 * - `better-sqlite3-multiple-ciphers` raises `TypeError: This database
 *   connection is busy executing a query` if a write is issued on a
 *   connection while a read iterator is still open on the same
 *   connection (the C++ `REQUIRE_DATABASE_NO_ITERATORS_UNLESS_UNSAFE`
 *   macro). The previous implementation used
 *   `for await (...of reader.iterateActiveByKind(...))` and called
 *   `writer.applyDecay(...)` inside the loop, which crashed for any
 *   workspace with real data. Mock-based unit tests did not surface
 *   the bug because the in-memory reader had no native iterator.
 * - The fix splits the pass into three phases per kind:
 *     1. READ — eagerly materialise the projections via
 *        `MemoryEntryReader.listActiveByKind(...)` (the same port
 *        already used by `ConsolidateSimilarUseCase`). The cursor
 *        closes before any writer call.
 *     2. COMPUTE — run the pure `DecayCalculator` over each
 *        projection and accumulate the (kind, id, newConfidence)
 *        tuples that actually need to change.
 *     3. WRITE — hand the batch to
 *        `MemoryEntryWriter.applyDecayBatch(...)`, which wraps every
 *        UPDATE in a single SQL transaction. One fsync per kind
 *        instead of one per row keeps the 50K-entry budget under
 *        30s.
 * - Memory cost: a 50K-row workspace holds ~5–10 MB of projections at
 *   peak (Phase 1) — well below the curator's process budget.
 *
 * Error handling: any per-row failure inside `applyDecayBatch` rolls
 * back the entire kind's transaction and bubbles up. The use case
 * does NOT swallow individual errors because partial decay would
 * leave the workspace in an inconsistent decay state across kinds.
 */
export class ApplyDecayUseCase implements ApplyDecay {
  public constructor(
    private readonly reader: MemoryEntryReader,
    private readonly writer: MemoryEntryWriter,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  public async apply(input: {
    runId: CuratorRunId;
    workspaceId: WorkspaceId;
  }): Promise<ApplyDecayResult> {
    const nowMs = this.clock.nowMs();
    let entriesScanned = 0;
    let entriesDecayed = 0;

    for (const kindLiteral of MemoryEntryKind.all()) {
      const kind = MemoryEntryKind.create(kindLiteral);
      // Phase 1 — READ. The eager `listActiveByKind` closes the
      // SQLite cursor before any writer call (Bug F).
      const projections = await this.reader.listActiveByKind({
        workspaceId: input.workspaceId,
        kind,
      });
      entriesScanned += projections.length;

      // Phase 2 — COMPUTE. Pure CPU work; no I/O.
      const pending: PendingDecay[] = [];
      for (const projection of projections) {
        const decay = this.computeDecay(projection, nowMs);
        if (decay !== null) pending.push(decay);
      }
      if (pending.length === 0) continue;

      // Phase 3 — WRITE. One transaction per kind keeps a mid-batch
      // failure recoverable while paying a single fsync.
      const changed = await this.writer.applyDecayBatch({
        workspaceId: input.workspaceId,
        items: pending,
      });
      entriesDecayed += changed;
    }

    this.logger.debug(
      {
        runId: input.runId.toString(),
        workspaceId: input.workspaceId.toString(),
        entriesScanned,
        entriesDecayed,
      },
      "curator: decay pass completed",
    );

    return {
      runId: input.runId,
      entriesScanned,
      entriesDecayed,
    };
  }

  /**
   * Computes the decay for a single projection. Returns the pending
   * write descriptor when the persisted confidence WOULD change, or
   * `null` when the calculator is a no-op (unity factor or zero-day
   * elapsed). Pure logic — no side effects, safe to call inside a
   * tight loop.
   */
  private computeDecay(
    projection: MemoryEntryProjection,
    nowMs: number,
  ): PendingDecay | null {
    const elapsedMs = nowMs - projection.lastUsedMs;
    const days = elapsedMs <= 0 ? 0 : elapsedMs / MS_PER_DAY;
    const newConfidence = DecayCalculator.newConfidence({
      current: projection.confidence,
      daysSinceLastUsed: days,
      kind: projection.kind,
      severity: projection.severity,
    });
    if (newConfidence.equals(projection.confidence)) return null;
    return {
      kind: projection.kind,
      entryId: projection.id,
      newConfidence,
    };
  }
}
