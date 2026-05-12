import { z } from "zod";

import type { DatabaseConnection } from "../../../../shared/application/ports/database-connection.port.ts";
import type { Logger } from "../../../../shared/application/ports/logger.port.ts";
import type {
  ConsolidationCandidate,
  SimilarityFinder,
  SimilarityPair,
} from "../../application/ports/out/similarity-finder.port.ts";
import type { ConsolidationThreshold } from "../../domain/value-objects/consolidation-threshold.ts";
import { CosineScore } from "../../domain/value-objects/cosine-score.ts";

/**
 * Maximum number of nearest neighbours requested per candidate. Used
 * by the sqlite-vec KNN query (`MATCH '... k=?'`). The threshold is
 * separate from the consolidation threshold: we ask sqlite-vec for
 * the top-K closest entries by *distance* and then filter the
 * resulting cosine score in code.
 *
 * Why 8: per `docs/05-memoria-decay.md` §3 the curator only fuses
 * pairs above 0.92, which in practice is a tiny tail; pulling the
 * top-8 neighbours covers the worst case in a typical workspace and
 * keeps the per-candidate query cost flat.
 */
const KNN_PER_CANDIDATE = 8;

/**
 * Zod schema for a row of the batch embedding lookup. The SELECT pulls
 * `(id, embedding)` from the `embeddings` virtual table for every
 * candidate in a single round-trip (see {@link buildBatchLoadSql}).
 *
 * Refactor W-3.4-PERF-H3: previously the adapter ran one
 * `SELECT ... WHERE id = ?` per candidate (the "1+1 lookup" N+1
 * pattern). The new shape returns the embedding alongside its id so the
 * caller can build an `id → embedding` map after a single query.
 */
const EmbeddingRowSchema = z.object({
  id: z.string().min(1),
  embedding: z.instanceof(Uint8Array),
});

/**
 * Zod schema for a row of the vec0 KNN query. The schema is intentionally
 * defensive: the `id` field is the candidate id we paired against; the
 * `distance` column is what sqlite-vec returns (lower = more similar).
 */
const KnnRowSchema = z.object({
  id: z.string().min(1),
  distance: z.number(),
});

/**
 * Builds the parametrised SQL for the batch embedding lookup. Generates
 * one `?` placeholder per candidate id; the placeholders are bound
 * positionally with `stmt.all(...ids)`. NEVER interpolate user data:
 * only the placeholder count is templated, every id flows through the
 * driver's prepared-statement binding.
 *
 * Why a dynamic placeholder list instead of `IN (json_each(?))` or a
 * temp table: the candidate set is bounded by the consolidation budget
 * (`< 500 per pass`, `docs/05-memoria-decay.md` §3), keeping the SQL
 * size well below SQLite's 999-bind-parameter default limit. The
 * dynamic IN list is the canonical, driver-agnostic approach.
 */
function buildBatchLoadSql(count: number): string {
  const placeholders = new Array<string>(count).fill("?").join(", ");
  return `
SELECT id, embedding
FROM embeddings
WHERE id IN (${placeholders})
`.trim();
}

/**
 * SQL for the cosine-distance KNN query on the sqlite-vec virtual
 * table. The query MUST run with positional parameters; do not use
 * string interpolation. The placeholders are bound below.
 *
 * Note: the exact SQL form depends on the sqlite-vec API version;
 * this query targets the `MATCH` syntax documented in
 * `docs/06-stack-tecnico.md` §7. If the vec0 binary is not loaded
 * (`SqliteDatabase.open(... loadVectorExtension: true)` failed), the
 * adapter degrades to no-op (returns an empty array) per the
 * `SimilarityFinder` contract.
 */
const SQL_KNN_BY_VECTOR = `
SELECT id, distance
FROM embeddings
WHERE embedding MATCH ?
  AND k = ?
ORDER BY distance ASC
`.trim();

/**
 * Adapter that fulfils the `SimilarityFinder` driving port using the
 * sqlite-vec `vec0` virtual table.
 *
 * The class accepts a separate `DatabaseConnection` for `vectors.db`
 * (the vectors DB is split from `recall.db` per
 * `docs/03-modelo-datos.md` §11). The composition root opens both
 * connections and supplies the right one here.
 *
 * Algorithm (refactor W-3.4-PERF-H3):
 * 1. Build a map `id → text` from the input candidates.
 * 2. **Batch-load every embedding in a single `SELECT ... WHERE id IN
 *    (?, ?, ...)` round-trip.** Candidates whose embedding is missing
 *    (`embedding_status` pending/failed) are silently absent from the
 *    map and skipped in step 3.
 * 3. For each candidate that has an embedding, run a KNN query asking
 *    for the `KNN_PER_CANDIDATE` closest neighbours. For each (a, b)
 *    pair where `a < b` (lexicographic), convert the distance to a
 *    cosine score and emit the pair if above threshold.
 * 4. Deduplicate pairs (`(a, b)` and `(b, a)` produce the same pair
 *    in our lexicographic ordering, but defensive deduplication is
 *    cheap).
 *
 * Cosine vs. distance: sqlite-vec's `vec0` exposes L2 by default; the
 * adapter assumes `cosine_distance` is enabled (the migration that
 * creates the `embeddings` table is owned by the retrieval module
 * and pins `cosine` as the metric, see `docs/03-modelo-datos.md`
 * §5). The conversion is `cosine_score = 1 - distance`.
 *
 * Performance (W-3.4-PERF-H3, refactor):
 * - Previously the adapter ran `2N` queries per pass (`N` embedding
 *   lookups + `N` KNN queries). The new shape replaces the per-
 *   candidate lookup with one batched `IN (...)` query, dropping the
 *   round-trips to `N + 1`. For a 500-candidate pass: from ~1000 to
 *   ~501 SQLite calls.
 * - The KNN statement is prepared exactly once per pass (`db.prepare`
 *   is invoked from this adapter at most twice: once for the batch
 *   load, once for the KNN). The driver's own statement cache is not
 *   relied upon for correctness; this adapter pins its own references.
 * - The adapter still does NOT compute the full O(n²) cosine matrix;
 *   the sqlite-vec KNN cuts the work to O(n × log n) for typical
 *   embedder dimensions (384–1024).
 *
 * Benchmark guidance: the N+1 pattern is structural — its cost is the
 * driver-side round-trip overhead, which is invisible on `:memory:`
 * fixtures (sub-microsecond per call). The synthetic benchmarks in
 * `tests/benchmarks/` will not show a measurable delta; the refactor's
 * value is realised on disk-backed prod databases (~50µs/call) and on
 * future ANN-backed adapters where batched lookups unlock vectorised
 * SIMD paths. See `HANDOFF.md` §8 (W-3.4-PERF-H3) for the rationale.
 *
 * Embedder dependency note: the MVP adapter does NOT recompute
 * embeddings on the fly — the consolidation pass strictly reads the
 * vectors persisted by the retrieval module's embedding worker.
 * Candidates whose embedding is missing are silently skipped (the
 * curator picks them up in a future pass once the queue catches up).
 * A future revision MAY accept an `Embedder` and recompute on-the-fly,
 * bounded by a per-pass cap; the constructor surface is intentionally
 * left narrow until that change is needed.
 */
export class Vec0SimilarityFinder implements SimilarityFinder {
  public constructor(
    private readonly vectorsDb: DatabaseConnection,
    private readonly logger: Logger,
  ) {}

  public async findPairs(input: {
    candidates: readonly ConsolidationCandidate[];
    threshold: ConsolidationThreshold;
  }): Promise<readonly SimilarityPair[]> {
    if (input.candidates.length < 2) return Promise.resolve(Object.freeze([]));

    const knnPerCandidate = Math.min(
      KNN_PER_CANDIDATE,
      input.candidates.length - 1,
    );
    const knownIds = new Set(input.candidates.map((c) => c.learningId));
    const seenPair = new Set<string>();
    const out: SimilarityPair[] = [];

    let knnStmt: ReturnType<DatabaseConnection["prepare"]>;
    try {
      knnStmt = this.vectorsDb.prepare(SQL_KNN_BY_VECTOR);
    } catch (cause: unknown) {
      // The vec0 extension may not be loaded (degraded mode). Per the
      // `SimilarityFinder` contract we silently return no pairs; the
      // curator's pass logs the degradation.
      this.logger.warn(
        {
          err: cause instanceof Error ? cause.message : String(cause),
        },
        "curator: similarity finder degraded (vec0 KNN unavailable); skipping consolidation",
      );
      return Promise.resolve(Object.freeze([]));
    }

    // Batch-load every embedding in a single round-trip
    // (W-3.4-PERF-H3). Candidates whose embedding is missing simply do
    // not appear in the map and get skipped in the loop below.
    const embeddingById = this.loadEmbeddingsBatch(input.candidates);

    for (const candidate of input.candidates) {
      const vectorBytes = embeddingById.get(candidate.learningId);
      if (vectorBytes === undefined) continue;

      let knnRows: readonly unknown[];
      try {
        knnRows = knnStmt.all(vectorBytes, knnPerCandidate + 1);
      } catch (cause: unknown) {
        this.logger.warn(
          {
            candidateId: candidate.learningId,
            err: cause instanceof Error ? cause.message : String(cause),
          },
          "curator: KNN query failed for a candidate; skipping",
        );
        continue;
      }

      for (const row of knnRows) {
        const parsed = this.parseKnnRow(row);
        if (parsed === null) continue;
        if (parsed.id === candidate.learningId) continue;
        if (!knownIds.has(parsed.id)) continue;

        const cosine = this.cosineFromDistance(parsed.distance);
        if (!input.threshold.qualifies(cosine)) continue;

        const [idA, idB] = orderedPair(candidate.learningId, parsed.id);
        const pairKey = `${idA}|${idB}`;
        if (seenPair.has(pairKey)) continue;
        seenPair.add(pairKey);

        out.push({
          idA,
          idB,
          cosineScore: CosineScore.of(cosine),
        });
      }
    }

    return Promise.resolve(Object.freeze(out));
  }

  /**
   * Single-round-trip lookup of every candidate's embedding bytes.
   *
   * Refactor W-3.4-PERF-H3: replaces the previous per-candidate
   * `SELECT ... WHERE id = ?` loop (1+1 lookup, N+1 antipattern). The
   * batch query uses positional `?` placeholders — one per candidate —
   * bound via `stmt.all(...ids)`. The placeholder count is the only
   * thing templated into the SQL string; every value still flows
   * through the driver's prepared-statement binding.
   *
   * Failure mode: if the batch SELECT throws (a corrupted vectors.db,
   * a closed connection, etc.), the adapter logs a warning and
   * returns an empty map; downstream the loop sees every candidate
   * as "missing embedding" and silently skips them, matching the
   * `SimilarityFinder` contract.
   *
   * Rows whose Zod validation fails are dropped from the map (defensive:
   * a corrupted row should not crash the entire pass).
   */
  private loadEmbeddingsBatch(
    candidates: readonly ConsolidationCandidate[],
  ): Map<string, Uint8Array> {
    const ids = candidates.map((c) => c.learningId);
    const sql = buildBatchLoadSql(ids.length);
    const out = new Map<string, Uint8Array>();

    let rows: readonly unknown[];
    try {
      const stmt = this.vectorsDb.prepare(sql);
      rows = stmt.all(...ids);
    } catch (cause: unknown) {
      this.logger.warn(
        {
          err: cause instanceof Error ? cause.message : String(cause),
          candidateCount: candidates.length,
        },
        "curator: batch embedding lookup failed; skipping consolidation pass",
      );
      return out;
    }

    for (const row of rows) {
      const parsed = EmbeddingRowSchema.safeParse(row);
      if (!parsed.success) continue;
      out.set(parsed.data.id, parsed.data.embedding);
    }
    return out;
  }

  private parseKnnRow(raw: unknown): z.infer<typeof KnnRowSchema> | null {
    const parsed = KnnRowSchema.safeParse(raw);
    if (!parsed.success) return null;
    return parsed.data;
  }

  /**
   * Converts the `cosine_distance` returned by sqlite-vec to a cosine
   * similarity score in [-1, 1]. The relation is `cosine_score =
   * 1 - cosine_distance`. Clamps to the closed `CosineScore` interval
   * to absorb tiny floating-point excursions.
   */
  private cosineFromDistance(distance: number): number {
    const raw = 1 - distance;
    if (raw < -1) return -1;
    if (raw > 1) return 1;
    return raw;
  }
}

/**
 * Returns `(idA, idB)` lexicographically sorted so duplicate pairs
 * collapse into a single key.
 */
function orderedPair(a: string, b: string): readonly [string, string] {
  return a < b ? [a, b] : [b, a];
}
