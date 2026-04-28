import { InvalidInputError } from "../errors/invalid-input-error.ts";

/**
 * Value object representing the confidence (or relevance weight) of a
 * memory entry, in the closed interval [0, 1].
 *
 * Confidence is the field every persistent table carries (`turns`,
 * `decisions`, `learnings`, `entities`, `relations`; see
 * `docs/03-modelo-datos.md` §4) to model the curator's decay process
 * and the recall scoring weight (see `docs/05-memoria-decay.md`).
 *
 * Invariants:
 * - The wrapped value is a finite number in [0, 1].
 * - `decay(factor)` produces a new `Confidence` whose value is
 *   `current * factor`. The factor must itself be in [0, 1] so that
 *   the result is guaranteed to remain in the valid interval — this is
 *   why decay is implemented as multiplication: it is closed over
 *   [0, 1] when `factor in [0, 1]`, which makes the invariant
 *   structurally impossible to break.
 * - `boost(amount)` clamps the result to 1.0 because boosting beyond
 *   the upper bound would silently break the invariant.
 *
 * Equality:
 * - Two `Confidence` are equal iff their numeric values are equal.
 *   Floating-point equality is exact; if you need fuzzy comparison,
 *   compute it explicitly (e.g. `Math.abs(a - b) < epsilon`).
 */
export class Confidence {
  private constructor(public readonly value: number) {}

  /**
   * Maximum confidence (1.0). Convenience for new entries that have
   * not yet been touched by the decay pass.
   */
  public static full(): Confidence {
    return new Confidence(1);
  }

  /**
   * Minimum confidence (0.0). Entries at this level are candidates for
   * pruning by the curator.
   */
  public static none(): Confidence {
    return new Confidence(0);
  }

  /**
   * Builds a `Confidence` from a raw numeric value in [0, 1].
   */
  public static of(value: number): Confidence {
    if (!Number.isFinite(value)) {
      throw new InvalidInputError("confidence must be a finite number", {
        field: "value",
      });
    }
    if (value < 0 || value > 1) {
      throw new InvalidInputError(
        `confidence must be in the closed interval [0, 1] (got: ${String(value)})`,
        { field: "value" },
      );
    }
    return new Confidence(value);
  }

  /**
   * Multiplicative decay. Returns a new `Confidence` whose value is
   * `current * factor`. The factor must itself be in [0, 1].
   *
   * Multiplication is intentional: it keeps the result in [0, 1]
   * without any clamping, so the invariant is preserved by
   * construction rather than by post-hoc adjustment. Calling
   * `decay(0.95)` repeatedly produces the geometric decay used by the
   * curator (see `docs/03-modelo-datos.md` §2:
   * `curator.decay_factor: 0.95`).
   */
  public decay(factor: number): Confidence {
    if (!Number.isFinite(factor)) {
      throw new InvalidInputError("decay factor must be a finite number", {
        field: "factor",
      });
    }
    if (factor < 0 || factor > 1) {
      throw new InvalidInputError(
        `decay factor must be in the closed interval [0, 1] (got: ${String(factor)})`,
        { field: "factor" },
      );
    }
    return new Confidence(this.value * factor);
  }

  /**
   * Additive boost, clamped to 1.0. Useful when usage signals reinforce
   * an entry (the recall scoring may bump confidence on hit).
   */
  public boost(amount: number): Confidence {
    if (!Number.isFinite(amount)) {
      throw new InvalidInputError("boost amount must be a finite number", {
        field: "amount",
      });
    }
    if (amount < 0) {
      throw new InvalidInputError("boost amount must be non-negative", {
        field: "amount",
      });
    }
    const raw = this.value + amount;
    const clamped = raw > 1 ? 1 : raw;
    return new Confidence(clamped);
  }

  public isAboveOrEqual(threshold: Confidence): boolean {
    return this.value >= threshold.value;
  }

  public isBelow(threshold: Confidence): boolean {
    return this.value < threshold.value;
  }

  public toNumber(): number {
    return this.value;
  }

  public equals(other: Confidence): boolean {
    return this.value === other.value;
  }
}
