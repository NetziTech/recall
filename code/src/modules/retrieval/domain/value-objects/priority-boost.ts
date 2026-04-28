import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";

/**
 * Maximum boost the domain accepts. Picked at 10 so that an explicit
 * "very important" entry can dominate the ranking, but not so wide that
 * a typo (`100x`) silently buries every other signal. The hybrid scorer
 * uses the boost as a multiplicative factor on the post-fusion score
 * (see `hybrid-scorer.ts`), so a cap of 10 means a critical learning
 * can outrank a regular entry by up to one order of magnitude — enough
 * to surface but not enough to monopolise.
 */
const MAX_PRIORITY_BOOST = 10;

/**
 * Value object representing the explicit priority multiplier of an
 * entry, mirroring `explicit_priority` in the hybrid scoring formula
 * documented in `docs/01-arquitectura.md` §2.6:
 * ```
 * final_score = ... + 0.05 * explicit_priority
 * ```
 *
 * Modelling decision — multiplicative boost (≥ 1), not weight:
 *
 * The arch doc adds `explicit_priority` as one more weighted addend to
 * the additive sum. In practice the most useful "priority" signal is
 * "this `critical` learning should always surface" — a boolean amplifier
 * rather than a fine-grained percentage. Modelling priority as a
 * multiplicative boost (≥ 1) directly applied to the post-fusion score
 * captures that intent better:
 *
 *   - `PriorityBoost.none()` returns `1.0` (no effect, default).
 *   - `PriorityBoost.of(1.5)` modestly amplifies (e.g. a `warning`).
 *   - `PriorityBoost.of(3.0)` dominates (e.g. a `critical`).
 *
 * The hybrid scorer treats the boost as a post-fusion factor, which
 * keeps the `[0, 1]` arithmetic of the additive components clean and
 * lets priority do its job (push critical entries to the top) without
 * polluting the weight tuning.
 *
 * Invariants:
 * - `value` is a finite number greater than or equal to `1.0`.
 * - `value` does not exceed `MAX_PRIORITY_BOOST`.
 * - Instances are immutable.
 *
 * Equality:
 * - Two `PriorityBoost` are equal iff their numeric values match
 *   exactly.
 */
export class PriorityBoost {
  private constructor(public readonly value: number) {}

  /**
   * No boost (multiplier of `1.0`). Default for entries that carry no
   * priority signal.
   */
  public static none(): PriorityBoost {
    return new PriorityBoost(1);
  }

  /**
   * Builds a `PriorityBoost` from a raw float ≥ 1 and ≤
   * `MAX_PRIORITY_BOOST`.
   */
  public static of(value: number): PriorityBoost {
    if (!Number.isFinite(value)) {
      throw new InvalidInputError("priority boost must be a finite number", {
        field: "priority_boost",
      });
    }
    if (value < 1) {
      throw new InvalidInputError(
        `priority boost must be at least 1.0 (got: ${String(value)}); a value below 1 would suppress the entry, which is not the intent`,
        { field: "priority_boost" },
      );
    }
    if (value > MAX_PRIORITY_BOOST) {
      throw new InvalidInputError(
        `priority boost must be at most ${String(MAX_PRIORITY_BOOST)} (got: ${String(value)})`,
        { field: "priority_boost" },
      );
    }
    return new PriorityBoost(value);
  }

  public toNumber(): number {
    return this.value;
  }

  public isNeutral(): boolean {
    return this.value === 1;
  }

  public equals(other: PriorityBoost): boolean {
    return this.value === other.value;
  }
}
