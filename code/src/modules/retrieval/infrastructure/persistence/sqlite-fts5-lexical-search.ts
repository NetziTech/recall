import { z } from "zod";

import type { DatabaseConnection } from "../../../../shared/application/ports/database-connection.port.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type {
  LexicalSearch,
  LexicalSearchHit,
} from "../../domain/services/lexical-search.ts";
import { BM25Score } from "../../domain/value-objects/bm25-score.ts";
import { type QueryKindValue } from "../../domain/value-objects/query-kind.ts";
import type { QueryText } from "../../domain/value-objects/query-text.ts";
import type { RecallFilters } from "../../domain/value-objects/recall-filters.ts";

/**
 * Per-kind FTS5 join descriptor. Captures the four bits the search
 * adapter needs to issue a uniform query against any of the searchable
 * memory kinds:
 *
 *   - `kind`            — the discriminator carried into `LexicalSearchHit`.
 *   - `ftsTable`        — the FTS5 virtual table (`<entity>_fts`).
 *   - `joinKey`         — the unindexed column on the FTS5 table that
 *                         echoes the source row id (every spec'd FTS5
 *                         table uses `id UNINDEXED` for this).
 *   - `selectFromBase`  — the source kind table the join projects from
 *                         (only used when we need to push down filters
 *                         that the FTS5 table does not carry — e.g.
 *                         `superseded_by IS NULL` for decisions).
 */
interface KindFtsBinding {
  readonly kind: QueryKindValue;
  readonly ftsTable: string;
  readonly baseTable: string;
}

/**
 * The FTS5 tables documented in `docs/03-modelo-datos.md` §4.2-§4.5.
 * Owned by the memory module's schema migration, NOT by the
 * retrieval module — but consumed here to back lexical search.
 */
const FTS_BINDINGS: readonly KindFtsBinding[] = Object.freeze([
  { kind: "decision", ftsTable: "decisions_fts", baseTable: "decisions" },
  { kind: "learning", ftsTable: "learnings_fts", baseTable: "learnings" },
  { kind: "entity", ftsTable: "entities_fts", baseTable: "entities" },
  { kind: "turn", ftsTable: "turns_fts", baseTable: "turns" },
  // Tasks have no FTS5 table — the title is short and a `LIKE` query
  // is cheap enough; the lexical search returns no rows for the
  // `task` kind.
]);

/**
 * Zod schema for one row of the search query. The FTS5 `bm25(...)`
 * function is a SQL aggregate; the adapter wraps it in a SELECT and
 * decodes the result here.
 */
const HitRowSchema = z.object({
  kind: z.enum(["decision", "learning", "entity", "task", "turn"]),
  id: z.string().min(1),
  bm25_raw: z.number(),
});

/**
 * Sanitises the raw query string before handing it to FTS5.
 *
 * FTS5 accepts a small DSL (phrase queries, NEAR/k, AND/OR/NOT) that
 * unsanitised user input could weaponise into a 1000x slower walk.
 * The policy here is conservative: keep alphanumerics, ASCII space,
 * and a handful of punctuation; quote the full query so the FTS5
 * tokeniser treats it as a single phrase candidate. Stronger
 * tokenisation (per-word snowball + AND-join) is a future tuning
 * knob; the current shape is the BM25 default in `docs/03-modelo-
 * datos.md` §4.
 */
function sanitiseFtsQuery(raw: string): string {
  // Replace any character outside [A-Za-z0-9 ._-] with a space, then
  // collapse whitespace, then quote.
  const cleaned = raw
    .replace(/[^A-Za-z0-9 ._-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length === 0) return '""';
  return `"${cleaned}"`;
}

/**
 * Per-kind SELECT template. The query is parameterised on:
 *   - `?1` the FTS5 query string (sanitised);
 *   - `?2` the limit.
 *
 * FTS5 `bm25(...)` returns a NEGATIVE float where lower = better
 * match (`docs/03-modelo-datos.md` §4 footnote and the SQLite docs).
 * The adapter feeds the raw value through `BM25Score.fromRawNegated`
 * so the rest of the pipeline sees a non-negative similarity-shaped
 * number.
 */
function buildSelect(binding: KindFtsBinding, limit: number): string {
  // NOTE: SQLite's FTS5 `bm25(...)` requires the literal table name as
  // its argument; an alias is rejected with `no such column: <alias>`.
  // We therefore reference the unaliased table both in the FROM clause
  // and inside `bm25(...)`. The query stays single-table so there is no
  // ambiguity in `WHERE <table> MATCH ?`.
  return `
SELECT
  '${binding.kind}'         AS kind,
  ${binding.ftsTable}.id    AS id,
  bm25(${binding.ftsTable}) AS bm25_raw
FROM ${binding.ftsTable}
WHERE ${binding.ftsTable} MATCH ?
ORDER BY bm25_raw ASC
LIMIT ${String(limit)}
`.trim();
}

/**
 * FTS5-backed adapter implementing `LexicalSearch`.
 *
 * Consumes the FTS5 virtual tables documented in
 * `docs/03-modelo-datos.md` §4.2-§4.5 (owned by the memory module's
 * schema). One query per active kind, then UNION ALL on the client
 * side; the per-kind LIMIT is the filters' `limit` divided by the
 * number of active kinds (rounded up) — empirically a good trade-off
 * between candidate diversity and total wall-clock.
 *
 * Filters not pushed into FTS5 (kind allowlist beyond the FTS5
 * table choice, tag filters, `since/until`, `min_confidence`) are
 * applied AFTER hydration in the `MemoryProjectionRepository`. The
 * lexical hit is just a pointer; the filter pass happens at row
 * resolution time.
 *
 * Failure modes:
 * - FTS5 syntax errors (e.g. unterminated phrase) raise as
 *   `DatabaseError`. The use case catches them and falls back to
 *   "no lexical hits".
 * - The `task` kind has no FTS5 table; queries for it return zero
 *   rows from this port. The recall pipeline still scores the task
 *   on cosine + recency + usage if its embedding exists.
 */
export class SqliteFts5LexicalSearch implements LexicalSearch {
  public constructor(private readonly db: DatabaseConnection) {}

  public search(
    query: QueryText,
    workspaceId: WorkspaceId,
    filters: RecallFilters,
  ): Promise<readonly LexicalSearchHit[]> {
    const ftsQuery = sanitiseFtsQuery(query.toString());
    const allowedKinds = new Set<QueryKindValue>(filters.getKindValues());
    const activeBindings: readonly KindFtsBinding[] =
      filters.hasNoKindFilter()
        ? FTS_BINDINGS
        : FTS_BINDINGS.filter((b) => allowedKinds.has(b.kind));

    if (activeBindings.length === 0) {
      return Promise.resolve(Object.freeze([]));
    }

    const perKindLimit = Math.max(
      1,
      Math.ceil(filters.limit / activeBindings.length),
    );

    const allHits: LexicalSearchHit[] = [];
    for (const binding of activeBindings) {
      const sql = buildSelect(binding, perKindLimit);
      const stmt = this.db.prepare(sql);
      const rows = stmt.all(ftsQuery);
      for (const raw of rows) {
        const parsed = HitRowSchema.parse(raw);
        allHits.push({
          kind: parsed.kind,
          id: parsed.id,
          score: BM25Score.fromRawNegated(parsed.bm25_raw),
        });
      }
    }

    // Final sort by score desc and overall slice. FTS5 returned each
    // kind sorted by its own bm25, so we re-sort across kinds.
    allHits.sort((a, b) => b.score.toNumber() - a.score.toNumber());
    void workspaceId; // workspace bookkeeping is future-proofing per
    // the port docstring; the per-project DB IS the workspace today.
    return Promise.resolve(
      Object.freeze(allHits.slice(0, filters.limit)),
    );
  }
}
