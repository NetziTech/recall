import { InvalidInputError } from "../errors/invalid-input-error.ts";
import { InvariantViolationError } from "../errors/invariant-violation-error.ts";

/**
 * Value object representing a count of language-model tokens.
 *
 * The MCP enforces token budgets across many surfaces:
 * `mem.context.max_tokens`, `mem.recall.max_tokens`, the per-layer
 * caps in `04-capas-contexto.md`, etc. Wrapping the count in a value
 * object keeps the budget arithmetic in one place and prevents
 * accidental misuse of `number` for unrelated quantities.
 *
 * Invariants:
 * - The wrapped count is a non-negative finite integer.
 * - `add` and `subtract` produce a new `Tokens` that respects the
 *   non-negativity invariant. Subtracting more than is available
 *   raises `InvariantViolationError` rather than silently clamping.
 *
 * Equality:
 * - Two `Tokens` are equal iff their counts match.
 */
export class Tokens {
  private constructor(public readonly count: number) {}

  public static zero(): Tokens {
    return new Tokens(0);
  }

  /**
   * Builds a `Tokens` from a raw integer count.
   */
  public static of(count: number): Tokens {
    if (!Number.isFinite(count)) {
      throw new InvalidInputError("token count must be a finite number", {
        field: "count",
      });
    }
    if (!Number.isInteger(count)) {
      throw new InvalidInputError("token count must be an integer", {
        field: "count",
      });
    }
    if (count < 0) {
      throw new InvalidInputError("token count must be non-negative", {
        field: "count",
      });
    }
    return new Tokens(count);
  }

  public add(other: Tokens): Tokens {
    return Tokens.of(this.count + other.count);
  }

  /**
   * Subtracts `other` from this count. Throws
   * `InvariantViolationError` if the result would be negative.
   */
  public subtract(other: Tokens): Tokens {
    const result = this.count - other.count;
    if (result < 0) {
      throw new InvariantViolationError(
        `cannot subtract ${String(other.count)} tokens from ${String(this.count)}: result would be negative`,
        { invariant: "tokens.non-negative" },
      );
    }
    return new Tokens(result);
  }

  public gte(other: Tokens): boolean {
    return this.count >= other.count;
  }

  public gt(other: Tokens): boolean {
    return this.count > other.count;
  }

  public lte(other: Tokens): boolean {
    return this.count <= other.count;
  }

  public lt(other: Tokens): boolean {
    return this.count < other.count;
  }

  public isZero(): boolean {
    return this.count === 0;
  }

  public toNumber(): number {
    return this.count;
  }

  public equals(other: Tokens): boolean {
    return this.count === other.count;
  }
}
