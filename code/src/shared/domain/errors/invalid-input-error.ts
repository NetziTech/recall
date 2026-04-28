import { DomainError } from "./domain-error.ts";

/**
 * Raised when an input fails to satisfy the validation rules of a value
 * object factory or aggregate constructor.
 *
 * Use this error to reject malformed external data (e.g. an id that is
 * not a UUID v7, a timestamp that is negative, a tag string that is
 * empty). It is the domain's way of saying "this value cannot exist in
 * our model".
 *
 * Invariants:
 * - `code` is the stable identifier `invalid-input`.
 * - `field` (when provided) names the offending input so adapters can
 *   build helpful error messages.
 */
export class InvalidInputError extends DomainError {
  public readonly code = "invalid-input";
  public readonly field: string | null;

  public constructor(
    message: string,
    options?: { field?: string; cause?: unknown },
  ) {
    super(message, options !== undefined ? { cause: options.cause } : undefined);
    this.field = options?.field ?? null;
  }
}
