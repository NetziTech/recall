import { RetrievalDomainError } from "./retrieval-domain-error.ts";

/**
 * Raised when an attempt to consume tokens would exceed the
 * `TokenBudget` cap of a context bundle assembly.
 *
 * `mem.context` and `mem.recall` declare a hard `max_tokens` ceiling
 * (see `docs/02-protocolo-mcp.md` §4.2 and §4.3 — `default 4800` for
 * context, `default 2000` for recall). The bundle assembler MUST refuse
 * to add a layer whose token cost would push the running total beyond
 * the cap; the alternative (silently truncating mid-content) would
 * break the contract that "the server respects the cap garantizadamente"
 * (`docs/02-protocolo-mcp.md` §1).
 *
 * Invariants:
 * - `code` is the stable identifier `retrieval.token-budget-exceeded`.
 * - `requestedTokens` is the cost the caller asked to consume (≥ 0).
 * - `availableTokens` is what was left in the budget at the time of the
 *   refusal (≥ 0).
 * - `maxTokens` is the absolute ceiling the budget was constructed with
 *   (> 0).
 * - `jsonRpcCode` is `null`: the protocol catalog does not allocate a
 *   wire code for "budget exceeded"; the adapter typically maps this to
 *   `INVALID_PARAMS` or surfaces it as a partial result.
 */
export class TokenBudgetExceededError extends RetrievalDomainError {
  public readonly code = "retrieval.token-budget-exceeded";
  public readonly jsonRpcCode: number | null = null;
  public readonly requestedTokens: number;
  public readonly availableTokens: number;
  public readonly maxTokens: number;

  public constructor(
    input: {
      requestedTokens: number;
      availableTokens: number;
      maxTokens: number;
    },
    options?: { cause?: unknown },
  ) {
    super(
      `requested ${String(input.requestedTokens)} tokens but only ${String(
        input.availableTokens,
      )} remain (cap: ${String(input.maxTokens)})`,
      options !== undefined ? { cause: options.cause } : undefined,
    );
    this.requestedTokens = input.requestedTokens;
    this.availableTokens = input.availableTokens;
    this.maxTokens = input.maxTokens;
  }
}
