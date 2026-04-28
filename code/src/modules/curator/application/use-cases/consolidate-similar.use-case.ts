import type { Clock } from "../../../../shared/application/ports/clock.port.ts";
import type { Logger } from "../../../../shared/application/ports/logger.port.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { LearningRepository } from "../../../memory/domain/repositories/learning-repository.ts";
import type { Learning } from "../../../memory/domain/aggregates/learning.ts";
import { LearningId } from "../../../memory/domain/value-objects/learning-id.ts";
import type { CuratorRun } from "../../domain/aggregates/curator-run.ts";
import type { CuratorRunRepository } from "../../domain/repositories/curator-run-repository.ts";
import type { PrunedEntryRepository } from "../../domain/repositories/pruned-entry-repository.ts";
import { AffectedEntryRef } from "../../domain/value-objects/affected-entry-ref.ts";
import { ConsolidationPair } from "../../domain/value-objects/consolidation-pair.ts";
import { ConsolidationThreshold } from "../../domain/value-objects/consolidation-threshold.ts";
import type { CuratorRunId } from "../../domain/value-objects/curator-run-id.ts";
import { MemoryEntryKind } from "../../domain/value-objects/memory-entry-kind.ts";
import { PrunedEntry } from "../../domain/value-objects/pruned-entry.ts";
import { PrunedReason } from "../../domain/value-objects/pruned-reason.ts";
import { CuratorApplicationError } from "../errors/curator-application-error.ts";
import type {
  ConsolidateSimilar,
  ConsolidateSimilarResult,
} from "../ports/in/consolidate-similar.port.ts";
import type {
  ConsolidationCandidate,
  SimilarityFinder,
  SimilarityPair,
} from "../ports/out/similarity-finder.port.ts";

/**
 * Maximum number of candidate `Learning`s the consolidation pass
 * inspects per run. Mirrors `docs/05-memoria-decay.md` §3 ("O(n²)
 * acotado a < 500 candidatos por pasada"). When the workspace exceeds
 * this cap, the use case picks the most-recently-used 500 (the
 * curator will pick up the rest in a future pass).
 */
const MAX_CANDIDATES_PER_PASS = 500;

/**
 * Use case: detect and merge semantically-equivalent `Learning`s.
 *
 * Implements the `ConsolidateSimilar` driving port. Orchestrates the
 * `SimilarityFinder` driven port and the `LearningRepository`
 * (cross-import to `memory/domain` authorised by ADR-001) to fold
 * losers into survivors.
 *
 * Algorithm (mirrors `docs/05-memoria-decay.md` §3):
 *
 * 1. Load every active `Learning` in the workspace via
 *    `LearningRepository.findByWorkspace(...)` and filter out
 *    consolidated ones (`learning.isActive() === false`).
 * 2. Sort by `(use_count + confidence)` descending and cap at
 *    `MAX_CANDIDATES_PER_PASS`.
 * 3. Project to `ConsolidationCandidate`s and ask the
 *    `SimilarityFinder` for cosine pairs above threshold.
 * 4. For each pair, build a `ConsolidationPair` VO (winner =
 *    higher score, loser = the other). Record the pair on the
 *    `CuratorRun` aggregate via `recordConsolidation(...)`.
 * 5. Call `Learning.consolidateInto(survivorId)` on the loser, save
 *    it, and archive a `PrunedEntry` snapshot with reason
 *    `consolidated_into_other` (so the audit trail captures the
 *    consolidation, not just the consolidated state on the
 *    aggregate).
 *
 * Why archive to `pruned` AND set `consolidatedInto`:
 * - The `consolidatedInto` field on the aggregate is the live,
 *   queryable state.
 * - The `pruned` row carries the historical content snapshot — useful
 *   when the user wants to undo a fold via a future `mem.unconsolidate`
 *   tool, or just to see what the loser said before its content was
 *   merged into the winner.
 * - The two writes happen in the same SQL transaction (via the
 *   adapter), so a partial fold is impossible.
 *
 * Idempotency: a learning that is already consolidated (chain
 * detection: `learning.getConsolidatedInto() !== null`) is skipped on
 * the second call.
 */
export class ConsolidateSimilarUseCase implements ConsolidateSimilar {
  public constructor(
    private readonly learnings: LearningRepository,
    private readonly similarityFinder: SimilarityFinder,
    private readonly curatorRuns: CuratorRunRepository,
    private readonly prunedRepo: PrunedEntryRepository,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  public async consolidate(input: {
    runId: CuratorRunId;
    workspaceId: WorkspaceId;
    threshold?: ConsolidationThreshold;
  }): Promise<ConsolidateSimilarResult> {
    const threshold = input.threshold ?? ConsolidationThreshold.default();

    const all = await this.learnings.findByWorkspace(input.workspaceId);
    const active = all.filter((l) => l.isActive());
    if (active.length < 2) {
      return {
        runId: input.runId,
        pairsDetected: 0,
        learningsFolded: 0,
      };
    }

    const ranked = [...active].sort((a, b) => this.score(b) - this.score(a));
    const limited = ranked.slice(0, MAX_CANDIDATES_PER_PASS);

    const byId = new Map<string, Learning>();
    const candidates: ConsolidationCandidate[] = [];
    for (const learning of limited) {
      const id = learning.getId().toString();
      byId.set(id, learning);
      candidates.push({
        learningId: id,
        text: learning.getText().toString(),
        useCount: learning.getUseCount().toNumber(),
        confidenceValue: learning.getConfidence().toNumber(),
      });
    }

    const pairs = await this.similarityFinder.findPairs({
      candidates,
      threshold,
    });

    const run = await this.curatorRuns.findById(input.runId);
    if (run === null) {
      throw CuratorApplicationError.runNotFound(input.runId.toString());
    }

    let foldedCount = 0;
    const folded = new Set<string>();
    for (const pair of pairs) {
      const folds = await this.processPair(pair, byId, folded, run);
      if (folds) foldedCount += 1;
    }

    if (foldedCount > 0) {
      await this.curatorRuns.save(run);
    }

    this.logger.debug(
      {
        runId: input.runId.toString(),
        workspaceId: input.workspaceId.toString(),
        candidateCount: candidates.length,
        pairsDetected: pairs.length,
        learningsFolded: foldedCount,
      },
      "curator: consolidation pass completed",
    );

    return {
      runId: input.runId,
      pairsDetected: pairs.length,
      learningsFolded: foldedCount,
    };
  }

  /**
   * Folds one similarity pair if it qualifies. Returns `true` if a
   * fold actually happened (the loser was active and got
   * consolidated). The mutation is bounded:
   *
   * - skip self-pairs (defensive: `SimilarityFinder` already filters
   *   them, but the contract is "may produce duplicates", not "must
   *   not");
   * - skip pairs where either side is missing from the candidate
   *   map (consolidated chain races);
   * - skip pairs where either side was already folded earlier in the
   *   same call (prevents A→B then B→C cycles within one pass).
   */
  private async processPair(
    pair: SimilarityPair,
    byId: ReadonlyMap<string, Learning>,
    folded: Set<string>,
    run: CuratorRun,
  ): Promise<boolean> {
    if (pair.idA === pair.idB) return false;
    if (folded.has(pair.idA) || folded.has(pair.idB)) return false;

    const a = byId.get(pair.idA);
    const b = byId.get(pair.idB);
    if (a === undefined || b === undefined) return false;
    if (!a.isActive() || !b.isActive()) return false;

    const winner = this.score(a) >= this.score(b) ? a : b;
    const loser = winner === a ? b : a;

    const winnerRef = AffectedEntryRef.of(
      MemoryEntryKind.learning(),
      winner.getId().toString(),
    );
    const loserRef = AffectedEntryRef.of(
      MemoryEntryKind.learning(),
      loser.getId().toString(),
    );
    const consolidationPair = ConsolidationPair.of({
      winner: winnerRef,
      loser: loserRef,
      cosineScore: pair.cosineScore,
    });

    const occurredAt = this.clock.now();
    run.recordConsolidation({ pair: consolidationPair, occurredAt });

    loser.consolidateInto({
      targetId: LearningId.from(winner.getId().toString()),
      occurredAt,
    });
    await this.learnings.save(loser);

    const snapshot = PrunedEntry.create({
      workspaceId: loser.getWorkspaceId(),
      kind: MemoryEntryKind.learning(),
      originalId: loser.getId().toString(),
      contentSnapshot: loser.getText().toString(),
      reason: PrunedReason.consolidatedIntoOther(),
      prunedAt: occurredAt,
    });
    await this.prunedRepo.save(snapshot);

    folded.add(loser.getId().toString());
    return true;
  }

  private score(learning: Learning): number {
    return (
      learning.getUseCount().toNumber() +
      learning.getConfidence().toNumber()
    );
  }
}
