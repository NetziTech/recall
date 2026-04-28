import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";

/**
 * Value object representing how many times a memory entry has been
 * surfaced (read by recall, returned in a context bundle, etc.).
 *
 * Mirrors the `use_count INTEGER NOT NULL DEFAULT 0` column on every
 * persistent kind (`turns`, `decisions`, `learnings`, `entities` —
 * `docs/03-modelo-datos.md` §4). Used by the curator's scoring formula
 * (`docs/01-arquitectura.md` §2.6: `usage_frequency`).
 *
 * Invariants:
 * - The wrapped count is a non-negative finite integer.
 * - `increment()` produces a new `UseCount` with `value + 1`. Mutation
 *   is forbidden; callers always replace the field with the new VO.
 *
 * Equality:
 * - Two `UseCount` are equal iff their numeric values match.
 */
export class UseCount {
  private constructor(public readonly value: number) {}

  /**
   * Newly-created entries start at zero.
   */
  public static zero(): UseCount {
    return new UseCount(0);
  }

  /**
   * Builds a `UseCount` from a raw integer. Rejects negative or
   * non-integer values.
   */
  public static of(value: number): UseCount {
    if (!Number.isFinite(value)) {
      throw new InvalidInputError("use count must be a finite number", {
        field: "use_count",
      });
    }
    if (!Number.isInteger(value)) {
      throw new InvalidInputError("use count must be an integer", {
        field: "use_count",
      });
    }
    if (value < 0) {
      throw new InvalidInputError("use count must be non-negative", {
        field: "use_count",
      });
    }
    return new UseCount(value);
  }

  /**
   * Returns a new `UseCount` increased by one.
   */
  public increment(): UseCount {
    return new UseCount(this.value + 1);
  }

  public toNumber(): number {
    return this.value;
  }

  public isZero(): boolean {
    return this.value === 0;
  }

  public equals(other: UseCount): boolean {
    return this.value === other.value;
  }
}
