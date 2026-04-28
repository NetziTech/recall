import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";

/**
 * Default weights matching `docs/01-arquitectura.md` §2.6:
 * ```
 * final_score = 0.4 * cosine_sim
 *             + 0.2 * bm25_normalized
 *             + 0.2 * recency_decay
 *             + 0.15 * usage_frequency
 *             + 0.05 * explicit_priority
 * ```
 *
 * Note: the `0.05 * explicit_priority` slot of the arch doc is folded
 * into `PriorityBoost` (a multiplicative post-fusion factor) rather than
 * an additive component — see the modelling note in `priority-boost.ts`.
 * The four weights modelled here therefore sum to `0.95`; the remaining
 * `0.05` "headroom" lives in `PriorityBoost`.
 *
 * The same defaults appear in `docs/03-modelo-datos.md` §2 under
 * `retrieval.scoring`, which is the per-workspace tuning knob:
 * ```json
 * {
 *   "cosine_weight": 0.4,
 *   "bm25_weight": 0.2,
 *   "recency_weight": 0.2,
 *   "usage_weight": 0.15,
 *   "priority_weight": 0.05
 * }
 * ```
 *
 * Operators may override the weights via that config block; this VO is
 * the single place that validates them.
 */
const DEFAULT_BM25_WEIGHT = 0.2;
const DEFAULT_COSINE_WEIGHT = 0.4;
const DEFAULT_RECENCY_WEIGHT = 0.2;
const DEFAULT_USAGE_WEIGHT = 0.15;

/**
 * Value object representing the four additive weights of the hybrid
 * relevance score.
 *
 * Modelling decisions:
 *
 * - The four weights are stored individually (rather than as a
 *   `Record<string, number>`) so the type system catches missing
 *   slots at compile time.
 * - The weights are NOT required to sum to 1. The hybrid scorer treats
 *   them as raw multipliers; what matters is the *relative* sizes. A
 *   caller is free to disable a component by setting its weight to
 *   `0`. The factory `defaults()` reproduces the doc's sum (0.95 with
 *   the priority headroom).
 * - Negative weights are rejected: a component with negative weight
 *   would *penalise* the entry the more relevant it is, which is never
 *   the intent (use `mustNotHaveTags` for hard filters).
 *
 * Invariants:
 * - Each of the four weights is a finite, non-negative number.
 * - At least one of the four weights is strictly positive (a recall
 *   pipeline that ignores every signal would always tie at zero, which
 *   is a bug).
 * - Instances are immutable.
 *
 * Equality:
 * - Two `RelevanceWeights` are equal iff every weight matches exactly.
 */
export class RelevanceWeights {
  private constructor(
    public readonly bm25Weight: number,
    public readonly cosineWeight: number,
    public readonly recencyWeight: number,
    public readonly usageWeight: number,
  ) {}

  /**
   * Returns the recommended defaults from `docs/01-arquitectura.md` §2.6.
   */
  public static defaults(): RelevanceWeights {
    return new RelevanceWeights(
      DEFAULT_BM25_WEIGHT,
      DEFAULT_COSINE_WEIGHT,
      DEFAULT_RECENCY_WEIGHT,
      DEFAULT_USAGE_WEIGHT,
    );
  }

  /**
   * Builds a `RelevanceWeights` from explicit weights. Each weight
   * must be finite and ≥ 0; at least one must be strictly positive.
   */
  public static of(input: {
    bm25Weight: number;
    cosineWeight: number;
    recencyWeight: number;
    usageWeight: number;
  }): RelevanceWeights {
    RelevanceWeights.assertWeight(input.bm25Weight, "bm25_weight");
    RelevanceWeights.assertWeight(input.cosineWeight, "cosine_weight");
    RelevanceWeights.assertWeight(input.recencyWeight, "recency_weight");
    RelevanceWeights.assertWeight(input.usageWeight, "usage_weight");
    const sum =
      input.bm25Weight +
      input.cosineWeight +
      input.recencyWeight +
      input.usageWeight;
    if (sum <= 0) {
      throw new InvalidInputError(
        "at least one of the four relevance weights must be strictly positive",
        { field: "weights" },
      );
    }
    return new RelevanceWeights(
      input.bm25Weight,
      input.cosineWeight,
      input.recencyWeight,
      input.usageWeight,
    );
  }

  /**
   * Sum of the four weights. Useful when the scorer wants to renormalise
   * the additive components into a `[0, 1]` range before applying the
   * priority boost.
   */
  public sum(): number {
    return (
      this.bm25Weight +
      this.cosineWeight +
      this.recencyWeight +
      this.usageWeight
    );
  }

  public equals(other: RelevanceWeights): boolean {
    if (this === other) return true;
    return (
      this.bm25Weight === other.bm25Weight &&
      this.cosineWeight === other.cosineWeight &&
      this.recencyWeight === other.recencyWeight &&
      this.usageWeight === other.usageWeight
    );
  }

  // -- internals -----------------------------------------------------------

  private static assertWeight(value: number, fieldName: string): void {
    if (!Number.isFinite(value)) {
      throw new InvalidInputError(`${fieldName} must be a finite number`, {
        field: fieldName,
      });
    }
    if (value < 0) {
      throw new InvalidInputError(
        `${fieldName} must be non-negative (got: ${String(value)}); a negative weight would penalise relevance`,
        { field: fieldName },
      );
    }
  }
}
