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
  | "cli.tty-io-error"
  | "cli.no-tty-for-passphrase"
  | "cli.passphrase-mismatch"
  | "cli.weak-passphrase";

export class CliInfrastructureError extends InfrastructureError {
  public readonly code: CliInfrastructureErrorCode;

  private constructor(
    code: CliInfrastructureErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause);
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

  /**
   * Raised when an interactive passphrase prompt is requested but
   * `process.stdin.isTTY` is `false` (piped input, closed `/dev/null`,
   * or a process wrapper that detached the controlling terminal).
   *
   * The CLI commands that consume `readPassphrase` (`init`, `add-key`,
   * `rekey`, `export-key`) MUST refuse to proceed in this case: the
   * raw-mode keystroke loop will not fire callbacks on a non-TTY
   * stream, so the promise would hang forever and the user would see a
   * silent-success failure (the worst diagnostic outcome). Per ADR-005
   * Q5, this is a separate error from `NonInteractiveStdinError`
   * (which is a domain-layer concern raised by `NodeReadlinePrompt`)
   * because the new prompts live in `cli/infrastructure/prompts/`
   * — they wrap raw-mode TTY IO directly without going through
   * `readline`.
   *
   * NOTE on JSON-RPC mapping: this is an infrastructure error
   * surfaced exclusively from `recall <command>` invocations on a
   * terminal, never inside an MCP JSON-RPC handler. It does NOT carry
   * a JSON-RPC code; the entrypoint maps it onto exit code 2
   * (`usageError`), same shape used by `NonInteractiveStdinError`.
   */
  public static noTtyForPassphrase(promptText: string): CliInfrastructureError {
    return new CliInfrastructureError(
      "cli.no-tty-for-passphrase",
      `stdin no es un TTY: no se puede pedir la passphrase "${promptText.trim()}". ` +
        `Ejecuta el comando desde una terminal interactiva (los flujos que ` +
        `requieren passphrase no aceptan input redirigido por razones de seguridad).`,
    );
  }

  /**
   * Raised by `confirmPassphrase` when the two passphrases entered do
   * not match byte-for-byte after the constant-time comparison. The
   * caller is expected to print a Spanish-language hint and ask the
   * user to retry; the message itself is intentionally generic so a
   * stderr leak does not hint at which entry was wrong.
   */
  public static passphraseMismatch(): CliInfrastructureError {
    return new CliInfrastructureError(
      "cli.passphrase-mismatch",
      "las dos passphrases ingresadas no coinciden.",
    );
  }

  /**
   * Raised by `assertStrongPassphrase` when the input is below the
   * configured strength floor (length < 12 chars OR Shannon entropy
   * < `minBits`). The message includes the failure dimension so the
   * `init` flow can surface a Spanish-language hint without leaking
   * the passphrase itself.
   */
  public static weakPassphrase(reason: string): CliInfrastructureError {
    return new CliInfrastructureError(
      "cli.weak-passphrase",
      `passphrase demasiado debil: ${reason}.`,
    );
  }
}
