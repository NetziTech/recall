import { InfrastructureError } from "../../../../shared/infrastructure/errors/infrastructure-error.ts";

/**
 * Concrete error raised by the CLI module's infrastructure adapters
 * (parser, terminal IO, prompt) when an operational failure happens
 * that does not fit any CLI-domain category.
 *
 * Examples:
 *   - The argv parser library threw a non-recognised internal error.
 *   - The `node:readline` stream closed mid-prompt because stdin was
 *     redirected to a closed pipe.
 *
 * The `code` field is one of the kebab-case identifiers in
 * {@link CliInfrastructureErrorCode}; callers SHOULD pattern match
 * on it rather than parse `message`.
 */
export type CliInfrastructureErrorCode =
  | "cli.parser-internal-error"
  | "cli.tty-io-error";

export class CliInfrastructureError extends InfrastructureError {
  public readonly code: CliInfrastructureErrorCode;

  private constructor(
    code: CliInfrastructureErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.code = code;
  }

  public static parserInternalError(cause: unknown): CliInfrastructureError {
    return new CliInfrastructureError(
      "cli.parser-internal-error",
      "the argv parser threw an unexpected error",
      cause,
    );
  }

  public static ttyIoError(cause: unknown): CliInfrastructureError {
    return new CliInfrastructureError(
      "cli.tty-io-error",
      "terminal IO failed",
      cause,
    );
  }
}
