import type { WorkspaceId } from "../../../../../shared/domain/value-objects/workspace-id.ts";
import type { ConsolidationThreshold } from "../../../domain/value-objects/consolidation-threshold.ts";
import type { CuratorRunId } from "../../../domain/value-objects/curator-run-id.ts";

/**
 * Outcome of one `ConsolidateSimilar` invocation.
 *
 * `pairsDetected` counts the cosine pairs above threshold. `learningsFolded`
 * is the subset of those pairs that actually produced a fold operation
 * (some pairs may be skipped when both sides are already in a
 * consolidation chain). `pairsDetected >= learningsFolded` always.
 */
export interface ConsolidateSimilarResult {
  readonly runId: CuratorRunId;
  readonly pairsDetected: number;
  readonly learningsFolded: number;
}

/**
 * Driving (input) port: detect and merge semantically-equivalent
 * `Learning` entries.
 *
 * Mirrors the consolidation step (#3) of the curator pass documented
 * in `docs/05-memoria-decay.md` §6 ("Pasada completa") and the merge
 * algorithm in §3 ("Algoritmo"). The use case:
 *
 * 1. Loads every active `Learning` of the workspace (`consolidatedInto
 *    === null`).
 * 2. Asks the `SimilarityFinder` driven port for cosine pairs above
 *    the threshold (default 0.92, override via the input).
 * 3. For each pair, picks the survivor (`score = use_count +
 *    confidence`, higher wins) and records a `ConsolidationPair` on
 *    the active `CuratorRun`.
 * 4. Calls `Learning.consolidateInto(survivorId)` on the loser, saves
 *    it, and archives a `PrunedEntry` snapshot with reason
 *    `consolidated_into_other`.
 *
 * Out-of-scope (per `docs/05-memoria-decay.md` §3 — "Que NO consolida"):
 * - `Decision`s never merge automatically; this use case ignores them.
 * - `Entity`s only collapse when (`name`, `entity_kind`) match exactly;
 *   that is handled by a future pass (NOT this use case).
 * - `Task`s never merge.
 * - `Turn`s never merge across this entry point (a session-scoped
 *   redundancy fold lives in `RollupSessionUseCase` instead).
 *
 * Idempotency:
 * - Calling this use case twice within the same `runId` is safe: the
 *   second call sees the loser already marked as consolidated and
 *   skips it. The pair-detection step IS deterministic once the
 *   underlying `Learning` set is stable, so the second call produces
 *   `pairsDetected === 0`.
 *
 * Performance:
 * - The orchestrator MUST run this use case AFTER `ApplyDecay` so
 *   the `confidence`-based scoring uses the freshly-decayed values.
 * - The implementation budget is <500 candidate pairs per pass
 *   (`docs/05-memoria-decay.md` §3 — "O(n²) acotado a < 500
 *   candidatos por pasada"). The `SimilarityFinder` adapter is
 *   responsible for the bound.
 */
export interface ConsolidateSimilar {
  consolidate(input: {
    runId: CuratorRunId;
    workspaceId: WorkspaceId;
    threshold?: ConsolidationThreshold;
  }): Promise<ConsolidateSimilarResult>;
}
