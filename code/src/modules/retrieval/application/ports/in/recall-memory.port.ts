import type { WorkspaceId } from "../../../../../shared/domain/value-objects/workspace-id.ts";
import type { RecallResult } from "../../../domain/aggregates/recall-result.ts";
import type { Query } from "../../../domain/value-objects/query.ts";
import type { RecallFilters } from "../../../domain/value-objects/recall-filters.ts";
import type { RelevanceWeights } from "../../../domain/value-objects/relevance-weights.ts";
import type { TokenBudget } from "../../../domain/value-objects/token-budget.ts";

/**
 * Driving (input) port: hybrid recall over the memory bounded context.
 *
 * Implements the `mem.recall` tool documented in
 * `docs/02-protocolo-mcp.md` §4.3 and the hybrid scoring formula in
 * `docs/01-arquitectura.md` §2.6:
 *
 * ```
 * final_score = w_cosine * cosine
 *             + w_bm25   * bm25
 *             + w_rec    * recency
 *             + w_use    * usage
 *             + (priority boost as multiplier)
 * ```
 *
 * Pipeline (orchestrated by `RecallMemoryUseCase`):
 * 1. Embed the query text (via the retrieval-flavoured `Embedder`
 *    port). When the embedder is down, the use case continues with
 *    BM25-only and reports `fallback_reason: "embedder_unavailable"`.
 * 2. Run lexical search (`LexicalSearch`) and vector search
 *    (`VectorSearch`) in parallel.
 * 3. Hydrate the union of hits into `MemoryProjection`s via
 *    `MemoryProjectionRepository.loadProjectionsByHits`.
 * 4. Compute the per-component scores and the final hybrid score
 *    via the `HybridScorer` domain service.
 * 5. Sort by final score, slice to `filters.limit`, fold into a
 *    `RecallResult` aggregate.
 * 6. Bump `use_count` / `last_used_ms` for the touched entries.
 *
 * Performance:
 * - Critical path: < 100 ms p95 on a 50 K-entry workspace
 *   (`docs/01-arquitectura.md` §10). Implementations must avoid per-
 *   row round trips and rely on the batch APIs of
 *   `MemoryProjectionRepository`.
 *
 * Why a use case (not a free function):
 * - The composition root injects the four output ports
 *   (`Embedder`, `LexicalSearch`, `VectorSearch`,
 *   `MemoryProjectionRepository`) plus the `Clock` and `Logger`
 *   exactly once. A function would force every caller to plumb six
 *   arguments.
 */
export interface RecallMemory {
  /**
   * Runs the hybrid pipeline.
   *
   * @param input.workspaceId - the workspace bounding the query.
   * @param input.query - the textual query. `null` triggers a
   *   filter-only listing (no embedding, no FTS5; just structured
   *   reads sorted by recency).
   * @param input.filters - structural filters (kinds, tags, time
   *   range, limit). Built once by the application boundary; the use
   *   case does not re-validate.
   * @param input.maxTokens - hard cap on the cumulative token cost
   *   of the rendered entries. Entries are dropped from the tail
   *   when the cap would be exceeded.
   * @param input.weights - the four additive weights (cosine, bm25,
   *   recency, usage). Defaults to
   *   `RelevanceWeights.defaults()`.
   */
  recall(input: {
    workspaceId: WorkspaceId;
    query: Query | null;
    filters: RecallFilters;
    maxTokens: TokenBudget;
    weights: RelevanceWeights;
  }): Promise<RecallResult>;
}
