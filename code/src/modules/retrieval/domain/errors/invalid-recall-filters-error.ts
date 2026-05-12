import { RetrievalDomainError } from "./retrieval-domain-error.ts";

/**
 * Raised when a `RecallFilters` value object cannot be built because
 * the input combination violates a domain invariant (e.g. `since` is
 * after `until`, `limit` is non-positive or above the cap, etc.).
 *
 * `mem.recall` enumerates the legal filter shape in
 * `docs/02-protocolo-mcp.md` §4.3; this error is the canonical signal
 * that the supplied filters violate one of those rules.
 *
 * Invariants:
 * - `code` is the stable identifier `retrieval.invalid-recall-filters`.
 * - `field` (when provided) names the offending input slot.
 * - `jsonRpcCode` is `null`: callers typically map this to
 *   `INVALID_PARAMS`.
 */
export class InvalidRecallFiltersError extends RetrievalDomainError {
  public readonly code = "retrieval.invalid-recall-filters";
  public readonly jsonRpcCode: number | null = null;
  public readonly field: string | null;

  public constructor(
    message: string,
    options?: { field?: string },
    cause?: unknown,
  ) {
    super(message, cause);
    this.field = options?.field ?? null;
  }
}
