import { CliDomainError } from "./cli-domain-error.ts";

/**
 * Raised when the CLI driver receives a token in argv that does not match
 * any registered `CommandName`.
 *
 * Example: a user types `recall innit` (typo). The infrastructure
 * argv parser hands the string `"innit"` to `CommandName.create(...)`,
 * which fails. The application layer catches the failure, wraps it in
 * this error so the terminal layer can surface a Spanish-language usage
 * hint plus the canonical exit code `usageError`.
 *
 * Invariants:
 * - `code` is the stable identifier `cli.unknown-command`.
 * - `attempted` preserves the raw token verbatim (including whitespace
 *   and case) so the message can echo it back to the user.
 * - `jsonRpcCode` is `null` per `CliDomainError`'s contract.
 */
export class UnknownCommandError extends CliDomainError {
  public readonly code = "cli.unknown-command";
  public readonly jsonRpcCode: number | null = null;
  public readonly attempted: string;

  public constructor(attempted: string, options?: { cause?: unknown }) {
    super(
      `unknown CLI command: "${attempted}"`,
      options !== undefined ? { cause: options.cause } : undefined,
    );
    this.attempted = attempted;
  }
}
