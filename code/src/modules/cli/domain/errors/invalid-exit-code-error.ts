import { CliDomainError } from "./cli-domain-error.ts";

/**
 * Raised when an attempt is made to construct an `ExitCode` from a
 * numeric value that is not a non-negative integer in the UNIX-allowed
 * range `0..255`.
 *
 * POSIX defines exit statuses as 8-bit unsigned integers; values outside
 * that range are wrapped or truncated by the kernel and lose meaning.
 * The CLI domain therefore refuses them at the boundary instead of
 * letting the infrastructure layer pass garbage to `process.exit`.
 *
 * Invariants:
 * - `code` is the stable identifier `cli.invalid-exit-code`.
 * - `attempted` preserves the offending number for diagnostics.
 * - `jsonRpcCode` is `null` per `CliDomainError`'s contract.
 */
export class InvalidExitCodeError extends CliDomainError {
  public readonly code = "cli.invalid-exit-code";
  public readonly jsonRpcCode: number | null = null;
  public readonly attempted: number;

  public constructor(attempted: number, options?: { cause?: unknown }) {
    super(
      `exit code must be a non-negative integer in 0..255 (got: ${String(attempted)})`,
      options !== undefined ? { cause: options.cause } : undefined,
    );
    this.attempted = attempted;
  }
}
