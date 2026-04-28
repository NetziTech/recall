import type { WorkspaceId } from "../../../../../shared/domain/value-objects/workspace-id.ts";
import type { ContextBundle } from "../../../domain/aggregates/context-bundle.ts";
import type { ContextLayerKindValue } from "../../../domain/value-objects/context-layer-kind.ts";
import type { Query } from "../../../domain/value-objects/query.ts";
import type { RelevanceWeights } from "../../../domain/value-objects/relevance-weights.ts";
import type { TokenBudget } from "../../../domain/value-objects/token-budget.ts";

/**
 * Per-layer token budget overrides keyed by `ContextLayerKindValue`.
 *
 * Mirrors the `layer_budgets` block in `.recall/config.json`
 * (`docs/03-modelo-datos.md` §2 — `retrieval.scoring`) and the
 * adaptable defaults of `docs/04-capas-contexto.md` §7. Any layer not
 * listed inherits the canonical default from the same doc:
 *
 * | Layer kind         | Default tokens |
 * |--------------------|---------------:|
 * | workspace_anchor   |             200 |
 * | active_decisions   |             600 |
 * | open_tasks         |             400 |
 * | recent_turns       |             800 |
 * | relevant_memory    |            1500 |
 * | entities_in_focus  |             600 |
 * | open_questions     |             300 |
 *
 * `Partial<...>` is intentional — overrides are sparse.
 */
export type LayerBudgetOverrides = Readonly<
  Partial<Record<ContextLayerKindValue, number>>
>;

/**
 * Driving (input) port: assemble the seven-layer `ContextBundle`.
 *
 * Implements the `mem.context` tool documented in
 * `docs/02-protocolo-mcp.md` §4.2 and the layered model documented in
 * `docs/04-capas-contexto.md`.
 *
 * Pipeline (orchestrated by `GetContextBundleUseCase`):
 * 1. Mint a `BundleId` and create an empty `ContextBundle`.
 * 2. For each of the seven layers, run the corresponding loader:
 *    - layer 1 (`workspace_anchor`): always present.
 *    - layer 2 (`active_decisions`): non-superseded decisions sorted
 *      by `use_count DESC`.
 *    - layer 3 (`open_tasks`): non-done tasks sorted by status +
 *      priority.
 *    - layer 4 (`recent_turns`): most recent N turns.
 *    - layer 5 (`relevant_memory`): hybrid recall against the query.
 *      Skipped when `query === null`.
 *    - layer 6 (`entities_in_focus`): vector-search-driven entity
 *      pull. Skipped when `query === null` or when no embedder is
 *      available.
 *    - layer 7 (`open_questions`): last 5 closed sessions' open
 *      questions.
 * 3. Token-budget each layer with the per-layer cap (override or
 *    default).
 * 4. Cross-layer dedup: an entry that already appears in a
 *    higher-priority layer is dropped from the lower-priority one
 *    (`docs/04-capas-contexto.md` §4).
 * 5. Enforce the global `maxTokens` ceiling — `truncate(...)` drops
 *    the lowest-priority layer first if the bundle still does not
 *    fit.
 *
 * Performance:
 * - Critical path: < 200 ms p95 on a 50 K-entry workspace
 *   (`docs/01-arquitectura.md` §10). Layers 1, 2, 3, 4, 7 are pure
 *   structured reads issued in parallel; layers 5 and 6 share the
 *   embedder result and run their searches in parallel.
 */
export interface GetContextBundle {
  /**
   * Builds the bundle.
   *
   * @param input.workspaceId - the workspace bounding the bundle.
   * @param input.query - the textual query. `null` skips layers 5
   *   and 6 (relevant_memory and entities_in_focus).
   * @param input.maxTokens - hard global ceiling. The bundle's
   *   running total is enforced to stay below this.
   * @param input.layerBudgets - per-layer overrides; sparse.
   * @param input.weights - hybrid weights for layer 5
   *   (relevant_memory). Defaults to
   *   `RelevanceWeights.defaults()`.
   */
  build(input: {
    workspaceId: WorkspaceId;
    query: Query | null;
    maxTokens: TokenBudget;
    layerBudgets: LayerBudgetOverrides;
    weights: RelevanceWeights;
  }): Promise<ContextBundle>;
}
