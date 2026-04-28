import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { CosineScore } from "../value-objects/cosine-score.ts";
import type { EmbeddingVector } from "../value-objects/embedding-vector.ts";
import type { QueryKindValue } from "../value-objects/query-kind.ts";
import type { RecallFilters } from "../value-objects/recall-filters.ts";

/**
 * One row of a vector-search result.
 *
 * Symmetric counterpart to `LexicalSearchHit`. The adapter returns
 * only what the hybrid pipeline needs to identify the candidate; the
 * application layer joins with the full aggregate when rendering.
 *
 * Invariants:
 * - `kind` is the kind of the entry (one of the `QueryKindValue`
 *   literals).
 * - `id` is a non-empty string.
 * - `score` is a `CosineScore` (already in the [0, 1] shape per the
 *   `CosineScore` contract).
 */
export interface VectorSearchHit {
  readonly kind: QueryKindValue;
  readonly id: string;
  readonly score: CosineScore;
}

/**
 * Driven port (interface) for the vector-search component
 * (sqlite-vec in the default infrastructure, see
 * `docs/03-modelo-datos.md` §5 and `docs/06-stack-tecnico.md` §7).
 *
 * Contracts:
 * - The `query` is an `EmbeddingVector` already produced by the
 *   `Embedder` port. The adapter does NOT re-embed.
 * - The `workspaceId` filters by the bundle's scope (analogous to
 *   `LexicalSearch`).
 * - The `filters` argument carries the kind filter, the tag filters,
 *   the time range, the `minConfidence`, and the `limit`. Adapters
 *   apply them in SQL.
 * - The result is a frozen array sorted by `score` descending (i.e.
 *   most-similar first). The length is at most `filters.limit`.
 * - When the vector index is unavailable (model mismatch, dimension
 *   drift, or the embedder is down), the adapter throws; the caller
 *   falls back to FTS5 only and reports `fallback_reason` on the
 *   `RecallResult`.
 */
export interface VectorSearch {
  /**
   * Searches the workspace's vector index for entries similar to the
   * query embedding.
   */
  search(
    query: EmbeddingVector,
    workspaceId: WorkspaceId,
    filters: RecallFilters,
  ): Promise<readonly VectorSearchHit[]>;
}
