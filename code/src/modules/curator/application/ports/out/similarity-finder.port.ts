import type { ConsolidationThreshold } from "../../../domain/value-objects/consolidation-threshold.ts";
import type { CosineScore } from "../../../domain/value-objects/cosine-score.ts";

/**
 * Reference to a single learning candidate the curator considers
 * for consolidation. The id is the canonical UUID v7 string of the
 * `Learning` aggregate; the embedding text is what the original
 * `Learning.text` was indexed under (the `searchable_text` of
 * `docs/03-modelo-datos.md` §5 — `content + "\n" + (trigger ?? "")`).
 *
 * This is intentionally NOT the `Learning` aggregate: the
 * `SimilarityFinder` adapter only needs the (id, text) tuple plus
 * the auxiliary signals it uses to break ties (`useCount`,
 * `confidence`). Forcing the adapter to hold a full aggregate would
 * couple the similarity infrastructure to `memory/domain` for no
 * reason.
 */
export interface ConsolidationCandidate {
  readonly learningId: string;
  readonly text: string;
  readonly useCount: number;
  readonly confidenceValue: number;
}

/**
 * One pair returned by `SimilarityFinder.findPairs(...)`. The pair is
 * carried as raw ids + cosine score so the application layer can
 * decide which side wins (the heuristic `score = use_count +
 * confidence` lives in
 * `ConsolidateSimilarUseCase`, not in the adapter).
 */
export interface SimilarityPair {
  readonly idA: string;
  readonly idB: string;
  readonly cosineScore: CosineScore;
}

/**
 * Driven (output) port that surfaces cosine-similarity pairs above a
 * threshold for the curator's consolidation pass.
 *
 * The default adapter (`Vec0SimilarityFinder` in
 * `modules/curator/infrastructure/similarity/`) reads the workspace's
 * `vectors.db` via the sqlite-vec extension and asks for nearest
 * neighbours per candidate, filtering out pairs below threshold and
 * (a, a) self-pairs.
 *
 * Contract:
 * - `findPairs(candidates, threshold)` returns every ordered,
 *   non-self pair `(idA, idB)` with `idA < idB` (lexicographic) whose
 *   cosine similarity is strictly greater than the threshold.
 * - The adapter may use Approximate Nearest Neighbour (ANN) indexes
 *   to stay within the 500-candidate budget documented in
 *   `docs/05-memoria-decay.md` §3 ("O(n²) acotado a < 500
 *   candidatos por pasada"). The curator's domain still trusts
 *   the threshold contract for any pair it does receive.
 * - The adapter MUST NOT raise on missing embeddings: a candidate
 *   whose embedding is `pending` or `failed` is silently skipped
 *   (the curator will pick it up in a future pass once the
 *   embedding-queue worker has caught up).
 *
 * Performance:
 * - The adapter uses prepared statements; the SQL is the same
 *   nearest-neighbour query reused per candidate.
 * - The adapter is allowed to short-circuit when `candidates.length
 *   === 0` or `candidates.length === 1`.
 */
export interface SimilarityFinder {
  findPairs(input: {
    candidates: readonly ConsolidationCandidate[];
    threshold: ConsolidationThreshold;
  }): Promise<readonly SimilarityPair[]>;
}
