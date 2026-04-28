import { z } from "zod";

import type { DatabaseConnection } from "../../../../shared/application/ports/database-connection.port.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type {
  VectorSearch,
  VectorSearchHit,
} from "../../domain/services/vector-search.ts";
import { CosineScore } from "../../domain/value-objects/cosine-score.ts";
import type { EmbeddingVector } from "../../domain/value-objects/embedding-vector.ts";
import { type QueryKindValue } from "../../domain/value-objects/query-kind.ts";
import type { RecallFilters } from "../../domain/value-objects/recall-filters.ts";

/**
 * Zod schema for one row returned by the vec0 K-NN query joined with
 * `embedding_metadata`. Validated at the SQL boundary so a tampered
 * file cannot bypass the domain invariants.
 */
const HitRowSchema = z.object({
  target_kind: z.enum(["decision", "learning", "entity", "task", "turn"]),
  target_row_id: z.string().min(1),
  distance: z.number(),
});

/**
 * vec0 K-NN query joined with the `embedding_metadata` side table.
 *
 * Mechanics:
 *   - vec0's `MATCH` operator over the bound `?1` blob runs an
 *     approximate K-NN search and returns rows with the implicit
 *     `distance` column (cosine distance in `[0, 2]`).
 *   - The JOIN with `embedding_metadata` recovers the source `(kind,
 *     row_id)` tuple that the rest of the pipeline keys on.
 *   - The `?2` workspace and `?3` K parameters are bound at execute
 *     time; the K is the filters' `limit` (the use case re-slices
 *     after hybrid scoring).
 *
 * Notes on workspace filtering:
 *   - The per-project DB IS the workspace today (`docs/03-modelo-
 *     datos.md` §4.1), but the metadata table carries `workspace_id`
 *     so a future multi-workspace flavour does not require schema
 *     migration. The WHERE clause is part of the contract.
 */
const SQL_KNN = `
SELECT
  m.target_kind  AS target_kind,
  m.target_row_id AS target_row_id,
  e.distance      AS distance
FROM embeddings AS e
INNER JOIN embedding_metadata AS m ON e.id = m.id
WHERE e.vec MATCH ?
  AND m.workspace_id = ?
  AND k = ?
ORDER BY e.distance ASC
`.trim();

/**
 * sqlite-vec backed adapter implementing `VectorSearch`.
 *
 * Consumes the `embeddings` (vec0) virtual table and the
 * `embedding_metadata` side table created by
 * `migrations/002__retrieval-schema.sql`.
 *
 * Pre-conditions:
 * - The `sqlite-vec` extension MUST have been loaded by the
 *   `SqliteDatabase` adapter at connection-open time
 *   (`docs/06-stack-tecnico.md` §7). When the platform does not have
 *   the extension, `SqliteDatabase.open` logs a warning and skips
 *   the load; this adapter then fails on the first `prepare` call —
 *   which the recall use case catches and downgrades to FTS5-only.
 *
 * Filtering:
 * - Kind filter is applied on the client side after the join — the
 *   metadata table carries `target_kind`, but pushing the filter
 *   into vec0's MATCH is not supported by the extension's current
 *   API. Tags / time-range / min-confidence filters are applied at
 *   hydration time by `MemoryProjectionRepository`.
 *
 * Encoding:
 * - The query vector is bound as a `Buffer` view over the
 *   `Float32Array` so better-sqlite3 hands it to vec0 as a binary
 *   blob.
 */
export class SqliteVecVectorSearch implements VectorSearch {
  public constructor(private readonly db: DatabaseConnection) {}

  public search(
    query: EmbeddingVector,
    workspaceId: WorkspaceId,
    filters: RecallFilters,
  ): Promise<readonly VectorSearchHit[]> {
    const buffer = query.toFloat32Array();
    const queryBytes = Buffer.from(
      buffer.buffer,
      buffer.byteOffset,
      buffer.byteLength,
    );

    const stmt = this.db.prepare(SQL_KNN);
    // We over-fetch by a factor of 4 (capped at 200) so the kind
    // filter applied client-side still produces enough candidates
    // for the hybrid ranker. The hard ceiling protects against
    // pathological recall budgets.
    const k = Math.min(200, Math.max(filters.limit, filters.limit * 4));
    const rows = stmt.all(queryBytes, workspaceId.toString(), k);

    const allowed = new Set<QueryKindValue>(filters.getKindValues());
    const noKindFilter = filters.hasNoKindFilter();

    const out: VectorSearchHit[] = [];
    for (const raw of rows) {
      const parsed = HitRowSchema.parse(raw);
      if (!noKindFilter && !allowed.has(parsed.target_kind)) continue;
      out.push({
        kind: parsed.target_kind,
        id: parsed.target_row_id,
        score: CosineScore.fromDistance(parsed.distance),
      });
      if (out.length >= filters.limit) break;
    }

    return Promise.resolve(Object.freeze(out));
  }
}
