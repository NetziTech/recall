import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";
import { Tokens } from "../../../../shared/domain/value-objects/tokens.ts";
import { TokenBudgetExceededError } from "../errors/token-budget-exceeded-error.ts";

/**
 * Value object representing the token budget of a `ContextBundle` (or
 * any other retrieval surface that needs to enforce a hard cap).
 *
 * The protocol promises a hard cap on every retrieval surface
 * (`docs/02-protocolo-mcp.md` §1: "el servidor respeta garantizadamente
 * ese tope"). The bundle assembler therefore needs a small, immutable
 * arithmetic object that:
 *   - knows the absolute ceiling (`maxTokens`);
 *   - tracks how many tokens have already been consumed (`usedTokens`);
 *   - refuses to consume more than what is left.
 *
 * This VO captures exactly that. It is immutable: `consume(...)` returns
 * a NEW `TokenBudget` so callers can roll back by simply discarding the
 * new instance.
 *
 * Invariants:
 * - `maxTokens` is a positive integer (a budget of zero would be
 *   degenerate).
 * - `usedTokens` is a non-negative integer ≤ `maxTokens`.
 * - `consume(n)` raises `TokenBudgetExceededError` when `n + usedTokens
 *   > maxTokens`. The alternative (silently clamping or partially
 *   consuming) would break the contract that adapters rely on.
 *
 * Equality:
 * - Two `TokenBudget` are equal iff their max and used counts match.
 */
export class TokenBudget {
  private constructor(
    public readonly maxTokens: number,
    public readonly usedTokens: number,
  ) {}

  /**
   * Builds a fresh budget with the given ceiling and zero consumption.
   */
  public static withMax(maxTokens: number): TokenBudget {
    if (!Number.isFinite(maxTokens)) {
      throw new InvalidInputError("maxTokens must be a finite number", {
        field: "max_tokens",
      });
    }
    if (!Number.isInteger(maxTokens)) {
      throw new InvalidInputError("maxTokens must be an integer", {
        field: "max_tokens",
      });
    }
    if (maxTokens <= 0) {
      throw new InvalidInputError(
        `maxTokens must be strictly positive (got: ${String(maxTokens)})`,
        { field: "max_tokens" },
      );
    }
    return new TokenBudget(maxTokens, 0);
  }

  /**
   * Rehydrates a budget with both fields explicit. Used by tests and
   * by checkpoint-style code that suspends and resumes the assembly.
   */
  public static of(input: {
    maxTokens: number;
    usedTokens: number;
  }): TokenBudget {
    if (!Number.isInteger(input.maxTokens) || input.maxTokens <= 0) {
      throw new InvalidInputError(
        `maxTokens must be a positive integer (got: ${String(input.maxTokens)})`,
        { field: "max_tokens" },
      );
    }
    if (!Number.isInteger(input.usedTokens) || input.usedTokens < 0) {
      throw new InvalidInputError(
        `usedTokens must be a non-negative integer (got: ${String(input.usedTokens)})`,
        { field: "used_tokens" },
      );
    }
    if (input.usedTokens > input.maxTokens) {
      throw new InvalidInputError(
        `usedTokens (${String(input.usedTokens)}) cannot exceed maxTokens (${String(input.maxTokens)})`,
        { field: "used_tokens" },
      );
    }
    return new TokenBudget(input.maxTokens, input.usedTokens);
  }

  /**
   * Tokens still available for consumption.
   */
  public remaining(): Tokens {
    return Tokens.of(this.maxTokens - this.usedTokens);
  }

  /**
   * True iff `tokens` would still fit in the remaining budget.
   */
  public canFit(tokens: Tokens): boolean {
    return this.usedTokens + tokens.toNumber() <= this.maxTokens;
  }

  /**
   * Returns a new `TokenBudget` with `tokens` added to the consumption.
   * Refuses to overshoot the ceiling.
   */
  public consume(tokens: Tokens): TokenBudget {
    const requested = tokens.toNumber();
    const available = this.maxTokens - this.usedTokens;
    if (requested > available) {
      throw new TokenBudgetExceededError({
        requestedTokens: requested,
        availableTokens: available,
        maxTokens: this.maxTokens,
      });
    }
    return new TokenBudget(this.maxTokens, this.usedTokens + requested);
  }

  public isExhausted(): boolean {
    return this.usedTokens >= this.maxTokens;
  }

  public equals(other: TokenBudget): boolean {
    if (this === other) return true;
    return (
      this.maxTokens === other.maxTokens &&
      this.usedTokens === other.usedTokens
    );
  }
}
