import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";

/**
 * Value object representing how many turns have been recorded inside a
 * `Session`.
 *
 * Mirrors the `sessions.turns_count INTEGER NOT NULL DEFAULT 0` column
 * documented in `docs/03-modelo-datos.md` §4.1. It is a denormalised
 * counter the curator uses to detect "empty" sessions (one started, no
 * turns recorded) and to size the rolling summary
 * (`docs/01-arquitectura.md` §2.5).
 *
 * It is a separate VO from `UseCount` (which counts how many times a
 * memory entry was *surfaced* by recall) because the two have different
 * semantics: turns_count grows whenever a turn is appended, regardless
 * of recall traffic.
 *
 * Invariants:
 * - The wrapped count is a non-negative finite integer.
 * - `increment()` produces a new `TurnsCount` with `value + 1`. Mutation
 *   is forbidden; callers always replace the field with the new VO.
 *
 * Equality:
 * - Two `TurnsCount` are equal iff their numeric values match.
 */
export class TurnsCount {
  private constructor(public readonly value: number) {}

  /**
   * Newly-started sessions begin with zero turns.
   */
  public static zero(): TurnsCount {
    return new TurnsCount(0);
  }

  /**
   * Builds a `TurnsCount` from a raw integer. Rejects negative or
   * non-integer values.
   */
  public static of(value: number): TurnsCount {
    if (!Number.isFinite(value)) {
      throw new InvalidInputError("turns count must be a finite number", {
        field: "turns_count",
      });
    }
    if (!Number.isInteger(value)) {
      throw new InvalidInputError("turns count must be an integer", {
        field: "turns_count",
      });
    }
    if (value < 0) {
      throw new InvalidInputError("turns count must be non-negative", {
        field: "turns_count",
      });
    }
    return new TurnsCount(value);
  }

  /**
   * Returns a new `TurnsCount` increased by one.
   */
  public increment(): TurnsCount {
    return new TurnsCount(this.value + 1);
  }

  public toNumber(): number {
    return this.value;
  }

  public isZero(): boolean {
    return this.value === 0;
  }

  public equals(other: TurnsCount): boolean {
    return this.value === other.value;
  }
}
