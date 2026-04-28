import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { BM25Score } from "../value-objects/bm25-score.ts";
import type { QueryKindValue } from "../value-objects/query-kind.ts";
import type { QueryText } from "../value-objects/query-text.ts";
import type { RecallFilters } from "../value-objects/recall-filters.ts";

/**
 * One row of a lexical-search result.
 *
 * The adapter returns minimal information (kind + id + score) and
 * leaves it to the application layer to look up the full aggregate or
 * its projection. The trade-off is one extra round trip to the
 * persistence layer; the gain is that the lexical-search port stays
 * agnostic of the aggregates' internal shape.
 *
 * Invariants:
 * - `kind` is the kind of the entry (one of the `QueryKindValue`
 *   literals).
 * - `id` is a non-empty string (the same string the corresponding
 *   `Id<...>` VO would wrap).
 * - `score` is a `BM25Score` (already normalised by the adapter).
 */
export interface LexicalSearchHit {
  readonly kind: QueryKindValue;
  readonly id: string;
  readonly score: BM25Score;
}

/**
 * Driven port (interface) for the lexical-search component (FTS5 in
 * the default infrastructure, see `docs/03-modelo-datos.md` §4 for
 * the FTS5 virtual tables).
 *
 * The port covers exactly the "find candidates whose text matches the
 * query" half of the hybrid pipeline. Vector search is the symmetric
 * port `VectorSearch`. The hybrid scorer fuses the two.
 *
 * Implementations live in `infrastructure/persistence/`. The default
 * adapter wraps SQLite's `bm25(...)` function over the `*_fts` tables
 * declared in §4.2-§4.5 of the data-model doc.
 *
 * Contracts:
 * - The `workspaceId` filters by the bundle's scope (in the per-
 *   project data model the workspace is the entire DB, so this
 *   parameter is mostly carried for symmetry — but adapters that one
 *   day support multi-workspace databases will need it).
 * - The `filters` argument carries the kind filter, the tag filters,
 *   the time range, the `minConfidence`, and the `limit`. Adapters
 *   apply them in SQL (push-down).
 * - The result is a frozen array sorted by `score` descending. The
 *   length is at most `filters.limit`.
 * - When the FTS5 index is unavailable (rebuild in progress, db
 *   locked, ...), the adapter throws; the caller falls back to
 *   recency-sorted listing.
 */
export interface LexicalSearch {
  /**
   * Searches the workspace's FTS5 index for entries matching `query`.
   */
  search(
    query: QueryText,
    workspaceId: WorkspaceId,
    filters: RecallFilters,
  ): Promise<readonly LexicalSearchHit[]>;
}
