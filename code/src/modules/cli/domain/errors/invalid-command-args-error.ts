import { CliDomainError } from "./cli-domain-error.ts";

/**
 * Raised when the CLI driver receives a recognised command but the
 * accompanying arguments fail validation.
 *
 * The CLI domain treats the *shape* of args as `unknown` (see
 * `CommandArgs`): only the application-layer parser knows the Zod schema
 * for each command. When that parser rejects an input it raises this
 * error so the terminal layer can render a Spanish-language usage hint
 * and exit with `usageError`.
 *
 * Invariants:
 * - `code` is the stable identifier `cli.invalid-command-args`.
 * - `commandName` is the raw command token (string, since the recognised
 *   `CommandName` VO may not have been instantiated yet when the parser
 *   fails on its args). When the failure happens after `CommandName`
 *   resolution, the application layer is encouraged to pass
 *   `commandName.toString()`.
 * - `field` (when provided) names the offending option / positional so
 *   adapters can surface a more precise message.
 * - `jsonRpcCode` is `null` per `CliDomainError`'s contract.
 */
export class InvalidCommandArgsError extends CliDomainError {
  public readonly code = "cli.invalid-command-args";
  public readonly jsonRpcCode: number | null = null;
  public readonly commandName: string;
  public readonly field: string | null;

  public constructor(
    message: string,
    options: { commandName: string; field?: string },
    cause?: unknown,
  ) {
    super(message, cause);
    this.commandName = options.commandName;
    this.field = options.field ?? null;
  }
}
