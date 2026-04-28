import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";

/**
 * Value object representing a cosine similarity score in the closed
 * interval `[-1, 1]`.
 *
 * Cosine similarity is the standard hybrid-search ranking primitive
 * (see `docs/01-arquitectura.md` §2.6 — "scoring weights"). The
 * curator uses it to decide whether two learnings are fusion
 * candidates (see `docs/05-memoria-decay.md` §3 — `sim > THRESHOLD`).
 *
 * The strict mathematical co-domain of cosine similarity is `[-1, 1]`,
 * but in practice all the embedders we ship (BGE Small EN v1.5,
 * multilingual E5, ...) produce *normalised* embeddings whose dot
 * product lies in `[0, 1]`. The VO accepts the full range so it can
 * hold any score the infrastructure layer might return.
 *
 * Invariants:
 * - The wrapped value is a finite number in `[-1, 1]`.
 * - Instances are immutable.
 *
 * Equality:
 * - Two `CosineScore` are equal iff their numeric values match
 *   exactly.
 */
export class CosineScore {
  private constructor(public readonly value: number) {}

  /**
   * Builds a `CosineScore` from a raw numeric value in `[-1, 1]`.
   */
  public static of(value: number): CosineScore {
    if (!Number.isFinite(value)) {
      throw new InvalidInputError("cosine score must be a finite number", {
        field: "cosine_score",
      });
    }
    if (value < -1 || value > 1) {
      throw new InvalidInputError(
        `cosine score must be in the closed interval [-1, 1] (got: ${String(value)})`,
        { field: "cosine_score" },
      );
    }
    return new CosineScore(value);
  }

  public toNumber(): number {
    return this.value;
  }

  public equals(other: CosineScore): boolean {
    return this.value === other.value;
  }
}
