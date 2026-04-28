import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";

/**
 * Default cosine similarity above which two learnings are considered
 * fusion candidates by the curator.
 *
 * Mirrors the constant `THRESHOLD = 0.92` documented in
 * `docs/05-memoria-decay.md` §3 ("Algoritmo"). The threshold is
 * intentionally high: fusing learnings that are only loosely related
 * loses nuance (per `docs/05-memoria-decay.md` §10 — "Auto-merge
 * agresivo: Perdida de matices"). The number lives in this catalog
 * (instead of in the calling site) so the curator can evolve it in
 * one place.
 */
const DEFAULT_CONSOLIDATION_THRESHOLD = 0.92;

/**
 * Value object representing the cosine similarity threshold used by
 * the curator's consolidation pass.
 *
 * Two learnings whose cosine similarity exceeds this threshold are
 * declared "fusion candidates" and folded into a canonical entry by
 * `Learning.consolidateInto(...)` (see
 * `docs/05-memoria-decay.md` §3).
 *
 * Invariants:
 * - The wrapped value is a finite number in the closed interval
 *   `[0, 1]`. Zero would consolidate every pair; one would only
 *   consolidate identical embeddings.
 * - Instances are immutable.
 *
 * Equality:
 * - Two `ConsolidationThreshold` are equal iff their numeric values
 *   are exactly equal.
 */
export class ConsolidationThreshold {
  private constructor(public readonly value: number) {}

  /**
   * Default threshold (`0.92`, per `docs/05-memoria-decay.md` §3).
   */
  public static default(): ConsolidationThreshold {
    return new ConsolidationThreshold(DEFAULT_CONSOLIDATION_THRESHOLD);
  }

  /**
   * Builds a `ConsolidationThreshold` from a raw numeric value in
   * `[0, 1]`.
   */
  public static of(value: number): ConsolidationThreshold {
    if (!Number.isFinite(value)) {
      throw new InvalidInputError(
        "consolidation threshold must be a finite number",
        { field: "consolidation_threshold" },
      );
    }
    if (value < 0 || value > 1) {
      throw new InvalidInputError(
        `consolidation threshold must be in the closed interval [0, 1] (got: ${String(value)})`,
        { field: "consolidation_threshold" },
      );
    }
    return new ConsolidationThreshold(value);
  }

  /**
   * True iff the supplied cosine score qualifies for consolidation
   * under this threshold (strictly greater than the threshold,
   * matching the `> THRESHOLD` comparison in
   * `docs/05-memoria-decay.md` §3).
   */
  public qualifies(cosineScore: number): boolean {
    if (!Number.isFinite(cosineScore)) return false;
    return cosineScore > this.value;
  }

  public toNumber(): number {
    return this.value;
  }

  public equals(other: ConsolidationThreshold): boolean {
    return this.value === other.value;
  }
}
