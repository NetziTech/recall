import { CuratorDomainError } from "./curator-domain-error.ts";

/**
 * Raised when a `DecayFactor` factory receives a value outside the
 * legal half-open interval `(0, 1]`.
 *
 * The factor is exclusive of zero (a zero factor would erase
 * confidence in a single tick, defeating the "soft forgetting" model
 * documented in `docs/05-memoria-decay.md` §1) and inclusive of one
 * (a value of one means "no decay", which `task` and `learning
 * (critical)` actually use per the table in
 * `docs/05-memoria-decay.md` §2).
 *
 * Invariants:
 * - `code` is the stable identifier `curator.invalid-decay-factor`.
 * - `value` carries the offending number so adapters can build
 *   diagnostics.
 * - `jsonRpcCode` is `null` (this is a configuration / programming
 *   error, not a wire-protocol failure mode).
 */
export class InvalidDecayFactorError extends CuratorDomainError {
  public readonly code = "curator.invalid-decay-factor";
  public readonly jsonRpcCode: number | null = null;
  public readonly value: number;

  public constructor(value: number, options?: { cause?: unknown }) {
    super(
      `decay factor must be a finite number in the half-open interval (0, 1] (got: ${String(value)})`,
      options !== undefined ? { cause: options.cause } : undefined,
    );
    this.value = value;
  }
}
