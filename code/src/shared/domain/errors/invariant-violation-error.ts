import { DomainError } from "./domain-error.ts";

/**
 * Raised when an aggregate or value object detects that an internal
 * invariant has been violated as the result of a mutation.
 *
 * This is fundamentally different from `InvalidInputError`:
 * - `InvalidInputError` rejects an *external* input that never made it
 *   into the model.
 * - `InvariantViolationError` signals that a *legal-looking* operation
 *   would leave the model in an inconsistent state and is therefore
 *   refused.
 *
 * Examples:
 *   - Marking a decision as superseded when it is already superseded.
 *   - Subtracting more tokens than are available.
 *
 * Invariants:
 * - `code` is the stable identifier `invariant-violation`.
 * - `invariant` (when provided) names the rule that was about to be
 *   broken so adapters can attach diagnostics.
 */
export class InvariantViolationError extends DomainError {
  public readonly code = "invariant-violation";
  public readonly invariant: string | null;

  public constructor(
    message: string,
    options?: { invariant?: string },
    cause?: unknown,
  ) {
    super(message, cause);
    this.invariant = options?.invariant ?? null;
  }
}
