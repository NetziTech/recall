import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";

/**
 * Value object representing a cosine-similarity score between a query
 * embedding and an entry embedding.
 *
 * Modelling decision — the [0, 1] interval (NOT [-1, 1]):
 *
 * Cosine similarity is mathematically defined in `[-1, 1]`, but the
 * embedders this codebase uses (`fastembed-js` with BGE-Small-EN-1.5,
 * see `docs/06-stack-tecnico.md` §6) produce L2-normalised vectors
 * whose dot product is the cosine similarity, and the model is trained
 * such that semantically related sentences land in the positive half-
 * space. Negative similarities in practice mean "embedding is broken"
 * or "vectors come from different models" (the curator catches the
 * latter via `embedding_metadata.model_name`).
 *
 * To keep the hybrid score arithmetic in `[0, 1]` (so additive weights
 * stay interpretable), this VO clamps any negative input to `0`. The
 * clamping is documented and explicit so that adapters can rely on the
 * VO never returning a negative number — they do NOT have to defend
 * against it themselves. The decision aligns with `docs/01-arquitectura.md`
 * §2.6 where `cosine_sim` is treated as a relevance signal that grows
 * with similarity.
 *
 * Invariants:
 * - `score` is a finite number in the closed interval [0, 1].
 * - Instances are immutable.
 *
 * Equality:
 * - Two `CosineScore` are equal iff their numeric values match exactly.
 */
export class CosineScore {
  private constructor(public readonly score: number) {}

  /**
   * Maximum cosine similarity. Useful as a sentinel when an entry has
   * no embedding yet (the recall pipeline can substitute `1.0` to keep
   * the arithmetic alive while flagging `fallback_reason`, but the
   * default policy is to feed `0` — see `docs/01-arquitectura.md` §2.7).
   */
  public static one(): CosineScore {
    return new CosineScore(1);
  }

  /**
   * Convenience for "no semantic match".
   */
  public static zero(): CosineScore {
    return new CosineScore(0);
  }

  /**
   * Builds a `CosineScore` from a raw float. Negative inputs are
   * clamped to `0` (see the modelling note in the class docstring).
   * Inputs above `1` are rejected because that would mean the embedder
   * returned a non-unit vector, which is a contract violation worth
   * surfacing.
   */
  public static of(value: number): CosineScore {
    if (!Number.isFinite(value)) {
      throw new InvalidInputError("cosine score must be a finite number", {
        field: "cosine_score",
      });
    }
    if (value > 1) {
      throw new InvalidInputError(
        `cosine score must be at most 1.0 (got: ${String(value)}); the embedder is expected to produce L2-normalised vectors`,
        { field: "cosine_score" },
      );
    }
    const clamped = value < 0 ? 0 : value;
    return new CosineScore(clamped);
  }

  /**
   * Builds a `CosineScore` from the *cosine distance* `1 - cos(theta)`
   * (the convention sqlite-vec uses for its `vec_distance_cosine`
   * function — see `docs/06-stack-tecnico.md` §7). The distance lives
   * in `[0, 2]`; this factory converts it to a similarity in `[0, 1]`
   * (capping the negative half at zero, matching the policy above).
   */
  public static fromDistance(distance: number): CosineScore {
    if (!Number.isFinite(distance)) {
      throw new InvalidInputError("cosine distance must be a finite number", {
        field: "cosine_distance",
      });
    }
    if (distance < 0) {
      throw new InvalidInputError(
        `cosine distance must be non-negative (got: ${String(distance)})`,
        { field: "cosine_distance" },
      );
    }
    const similarity = 1 - distance;
    const clamped = similarity < 0 ? 0 : similarity > 1 ? 1 : similarity;
    return new CosineScore(clamped);
  }

  public toNumber(): number {
    return this.score;
  }

  public isZero(): boolean {
    return this.score === 0;
  }

  public equals(other: CosineScore): boolean {
    return this.score === other.score;
  }
}
