import { RetrievalDomainError } from "./retrieval-domain-error.ts";

/**
 * Raised when a query supplied to the retrieval module fails to satisfy
 * the structural rules of a `Query` value object (e.g. empty text, text
 * exceeding the maximum length, or filter combinations that contradict
 * each other).
 *
 * Distinct from `InvalidInputError` from the shared layer: callers can
 * route on `RetrievalDomainError` to map every retrieval failure
 * uniformly without inspecting the underlying error class.
 *
 * Invariants:
 * - `code` is the stable identifier `retrieval.invalid-query`.
 * - `field` (when provided) names the offending input slot so adapters
 *   can build helpful messages.
 * - `jsonRpcCode` is `null`: the catalog does not allocate a wire code;
 *   the adapter usually maps this to `INVALID_PARAMS`.
 */
export class InvalidQueryError extends RetrievalDomainError {
  public readonly code = "retrieval.invalid-query";
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
