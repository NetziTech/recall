/**
 * Abstract base class for every error raised by the domain layer.
 *
 * Domain errors are the canonical way to signal an invariant violation
 * or an invalid input that the caller could have foreseen. They are
 * distinct from generic JS errors so that the application and
 * infrastructure layers can map them onto JSON-RPC error codes (or any
 * other transport) without inspecting `instanceof Error`.
 *
 * Invariants:
 * - Every concrete subclass MUST expose a stable `code` (machine
 *   readable, kebab-case) so that adapters can route the error.
 * - The `message` is human-readable. User-facing messages should be in
 *   Spanish (per the global UI language guideline); technical messages
 *   stay in English.
 * - The `cause` is optional and preserves the original error when a
 *   domain error wraps a lower-level failure.
 * - `name` is set automatically to the concrete class name so that
 *   stack traces and logs are self-describing.
 */
export abstract class DomainError extends Error {
  public abstract readonly code: string;

  protected constructor(message: string, cause?: unknown) {
    super(message);
    this.name = new.target.name;
    if (cause !== undefined) {
      // `cause` is part of the standard Error options bag (ES2022) but we
      // assign it manually to avoid relying on a polyfill at runtime. Also
      // pinned non-enumerable so `JSON.stringify(err)` doesn't dump the
      // wrapped exception's payload — important when wrapping native
      // errors that may carry secrets in `.message`.
      Object.defineProperty(this, "cause", {
        value: cause,
        enumerable: false,
        writable: false,
        configurable: true,
      });
    }
  }
}
