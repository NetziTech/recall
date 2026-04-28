import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";

/**
 * Value object counting how many times a tool has been invoked since
 * the server started (or since the registry was last reset, whichever
 * happens first).
 *
 * Mirrors `UseCount` from the `memory` module conceptually but lives
 * here as a sibling VO instead of being shared, because the
 * bounded-context semantics differ:
 * - `memory.UseCount` tracks how often a *memory entry* has been
 *   surfaced to the model and feeds the curator's scoring formula.
 * - `mcp-server.InvocationCount` tracks how often a *tool* has been
 *   called and feeds the in-process registry bookkeeping.
 *
 * Cross-module importing is forbidden by the architecture rules
 * (`docs/12-lineamientos-arquitectura.md` §1.5), and promoting either
 * VO to `shared/` would only make sense if a *third* module needed the
 * same concept. Until then, keeping the duplication local is the
 * correct move.
 *
 * Invariants:
 * - The wrapped count is a non-negative finite integer.
 * - `increment()` produces a new `InvocationCount` with `value + 1`.
 *   Mutation is forbidden; callers always replace the field with the
 *   new VO.
 *
 * Equality:
 * - Two `InvocationCount` are equal iff their numeric values match.
 */
export class InvocationCount {
  private constructor(public readonly value: number) {}

  /**
   * Newly-registered tools start at zero.
   */
  public static zero(): InvocationCount {
    return new InvocationCount(0);
  }

  /**
   * Builds an `InvocationCount` from a raw integer. Rejects negative
   * or non-integer values.
   */
  public static of(value: number): InvocationCount {
    if (!Number.isFinite(value)) {
      throw new InvalidInputError("invocation count must be a finite number", {
        field: "invocation_count",
      });
    }
    if (!Number.isInteger(value)) {
      throw new InvalidInputError("invocation count must be an integer", {
        field: "invocation_count",
      });
    }
    if (value < 0) {
      throw new InvalidInputError("invocation count must be non-negative", {
        field: "invocation_count",
      });
    }
    return new InvocationCount(value);
  }

  /**
   * Returns a new `InvocationCount` increased by one.
   */
  public increment(): InvocationCount {
    return new InvocationCount(this.value + 1);
  }

  public toNumber(): number {
    return this.value;
  }

  public isZero(): boolean {
    return this.value === 0;
  }

  public equals(other: InvocationCount): boolean {
    return this.value === other.value;
  }
}
