import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";
import type { UseCount } from "../../../memory/domain/value-objects/use-count.ts";

/**
 * Value object representing the usage component of the hybrid score.
 *
 * Mirrors `usage_frequency` from `docs/01-arquitectura.md` §2.6:
 * ```
 * final_score = ... + 0.15 * usage_frequency + ...
 * ```
 *
 * Algorithm — saturating linear normalisation:
 * ```
 * usage = min(useCount / max(1, maxUseCount), 1)
 * ```
 * The score is `0` for never-used entries and `1` for entries whose
 * use count matches (or exceeds) the maximum in the candidate set.
 *
 * Why saturating linear and not log:
 * - The intuition is "use count is a popularity signal that saturates".
 *   A linear normalisation against the max in the *current candidate
 *   set* is monotone, easy to reason about, and zero-cost.
 * - A log shape (e.g. `log1p(useCount) / log1p(maxUseCount)`) would
 *   spread out low counts more, but the curator is expected to keep
 *   the use-count distribution narrow (entries with `use_count` of
 *   thousands are rare); the simple shape is fit-for-purpose.
 * - Both are monotone in `useCount`, so the relative ranking of the
 *   results is the same. If the curator team later prefers the log
 *   shape, only this VO changes.
 *
 * Edge cases:
 * - `maxUseCount === 0` (every entry in the result set is never-used)
 *   produces a score of `0` for everyone — the component carries no
 *   information so it does not contribute, which is the correct
 *   behaviour.
 *
 * Invariants:
 * - `score` is a finite number in the closed interval [0, 1].
 * - Instances are immutable.
 */
export class UsageScore {
  private constructor(public readonly score: number) {}

  public static one(): UsageScore {
    return new UsageScore(1);
  }

  public static zero(): UsageScore {
    return new UsageScore(0);
  }

  /**
   * Builds a `UsageScore` from an already-clamped numeric value in
   * [0, 1].
   */
  public static of(value: number): UsageScore {
    if (!Number.isFinite(value)) {
      throw new InvalidInputError("usage score must be a finite number", {
        field: "usage_score",
      });
    }
    if (value < 0 || value > 1) {
      throw new InvalidInputError(
        `usage score must be in the closed interval [0, 1] (got: ${String(value)})`,
        { field: "usage_score" },
      );
    }
    return new UsageScore(value);
  }

  /**
   * Computes the usage score for an entry given its use count and the
   * maximum use count in the candidate set.
   */
  public static compute(useCount: UseCount, maxUseCount: number): UsageScore {
    if (!Number.isFinite(maxUseCount)) {
      throw new InvalidInputError("maxUseCount must be a finite number", {
        field: "max_use_count",
      });
    }
    if (!Number.isInteger(maxUseCount)) {
      throw new InvalidInputError("maxUseCount must be an integer", {
        field: "max_use_count",
      });
    }
    if (maxUseCount < 0) {
      throw new InvalidInputError(
        `maxUseCount must be non-negative (got: ${String(maxUseCount)})`,
        { field: "max_use_count" },
      );
    }
    if (maxUseCount === 0) return new UsageScore(0);
    const ratio = useCount.toNumber() / maxUseCount;
    const clamped = ratio < 0 ? 0 : ratio > 1 ? 1 : ratio;
    return new UsageScore(clamped);
  }

  public toNumber(): number {
    return this.score;
  }

  public equals(other: UsageScore): boolean {
    return this.score === other.score;
  }
}
