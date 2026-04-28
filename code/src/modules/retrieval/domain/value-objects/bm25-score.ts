import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";

/**
 * Value object representing a raw BM25 lexical-relevance score returned
 * by the FTS5 `bm25(...)` function.
 *
 * SQLite's `bm25()` returns a non-negative float where lower numbers
 * mean *more relevant* (it is a distance, not a similarity). To keep
 * the rest of the pipeline uniform — every score in this domain grows
 * with relevance — the VO immediately negates the SQLite value at
 * construction. Callers feed the raw SQLite output through `fromRaw`
 * and the VO gives back a "similarity-shaped" non-negative number that
 * can be normalised against the maximum hit of the same query.
 *
 * Algorithm reference: `docs/01-arquitectura.md` §2.6 keeps `bm25_normalized`
 * as one of the five additive components in the hybrid score.
 *
 * Invariants:
 * - `score` is a finite, non-negative number (0 means "not retrieved by
 *   FTS5"; higher is more relevant).
 * - Instances are immutable; `normalize(maxScore)` produces a NEW VO.
 *
 * Equality:
 * - Two `BM25Score` are equal iff their numeric values match exactly.
 */
export class BM25Score {
  private constructor(public readonly score: number) {}

  /**
   * Convenience factory for "no lexical match" — used when an entry was
   * retrieved by the vector search but FTS5 did not surface it.
   */
  public static zero(): BM25Score {
    return new BM25Score(0);
  }

  /**
   * Builds a `BM25Score` from an already similarity-shaped non-negative
   * number (i.e. higher = more relevant). The validator only checks the
   * numeric invariant; the responsibility of feeding the right number
   * lies with the adapter that wraps SQLite's `bm25()`.
   */
  public static of(value: number): BM25Score {
    if (!Number.isFinite(value)) {
      throw new InvalidInputError("bm25 score must be a finite number", {
        field: "bm25_score",
      });
    }
    if (value < 0) {
      throw new InvalidInputError(
        `bm25 score must be non-negative (got: ${String(value)})`,
        { field: "bm25_score" },
      );
    }
    return new BM25Score(value);
  }

  /**
   * Wraps the raw SQLite `bm25()` output (lower-is-better) and converts
   * it to the similarity-shaped representation (`-rawValue`, then
   * shifted to be non-negative). The shift is implicit: callers usually
   * follow up with `normalize(maxScore)` so the absolute origin is
   * irrelevant.
   *
   * In practice the lexical-search adapter chooses one of two
   * conventions:
   * - call `BM25Score.fromRawNegated(rawValue)` to feed
   *   `Math.max(0, -rawValue)` (works when SQLite returns negative
   *   numbers — the FTS5 docs explicitly say "the smaller the value, the
   *   better the match"); or
   * - call `BM25Score.of(precomputedSimilarity)` after running its own
   *   normalisation.
   *
   * The negated form is offered as a convenience to keep the conversion
   * in the domain rather than scattering `Math.max(0, -x)` across the
   * adapters.
   */
  public static fromRawNegated(rawValue: number): BM25Score {
    if (!Number.isFinite(rawValue)) {
      throw new InvalidInputError("raw bm25 value must be a finite number", {
        field: "bm25_score",
      });
    }
    const flipped = -rawValue;
    const nonNegative = flipped < 0 ? 0 : flipped;
    return new BM25Score(nonNegative);
  }

  /**
   * Returns a new `BM25Score` rescaled to [0, 1] by dividing by
   * `maxScore`. When `maxScore <= 0` (no FTS5 hit in the result set),
   * returns a score of `0` — the alternative would be a NaN that
   * silently breaks downstream arithmetic.
   */
  public normalize(maxScore: number): BM25Score {
    if (!Number.isFinite(maxScore)) {
      throw new InvalidInputError(
        "normalisation maxScore must be a finite number",
        { field: "bm25_score" },
      );
    }
    if (maxScore <= 0) {
      return new BM25Score(0);
    }
    const ratio = this.score / maxScore;
    const clamped = ratio > 1 ? 1 : ratio < 0 ? 0 : ratio;
    return new BM25Score(clamped);
  }

  public toNumber(): number {
    return this.score;
  }

  public isZero(): boolean {
    return this.score === 0;
  }

  public equals(other: BM25Score): boolean {
    return this.score === other.score;
  }
}
