import type { Logger } from "../../../../shared/application/ports/logger.port.ts";
import type {
  Stderr,
  Stdout,
} from "../../application/ports/out/tty.port.ts";
import type { RunCliCommand } from "../../application/ports/in/run-cli-command.port.ts";
import { CliDomainError } from "../../domain/errors/cli-domain-error.ts";
import { ExitCode } from "../../domain/value-objects/exit-code.ts";
import type { CommanderCliParser } from "../parser/commander-cli-parser.ts";

/**
 * Adapter that orchestrates one CLI invocation end-to-end:
 *
 *   1. Parses argv via `CommanderCliParser`.
 *   2. Forwards the parsed `CliInvocation` to the `RunCliCommand` port.
 *   3. Writes the resulting `CommandOutput` streams to stdout/stderr.
 *   4. Returns the integer exit code so the caller (the binary entry
 *      point) can call `process.exit`.
 *
 * The entrypoint never instantiates use cases or facades itself —
 * it receives them via constructor injection from the composition
 * root (Fase 4 wires `CliEntrypoint` together with `RunCliCommandUseCase`
 * and the concrete handlers).
 *
 * Why we do NOT call `process.exit` here:
 *   - `process.exit` is a global side effect that races with stdout
 *     flushing on some terminals. We let the caller invoke it after
 *     this method returns, with the integer result as argument.
 *
 * Error mapping:
 *   - Parser errors (`UnknownCommandError`,
 *     `InvalidCommandArgsError`) are CLI-domain and map to
 *     `usageError`.
 *   - Use-case errors are already classified inside
 *     `RunCliCommandUseCase`; the entrypoint forwards the
 *     `CommandOutput.exitCode` verbatim.
 */
export class CliEntrypoint {
  public constructor(
    private readonly parser: CommanderCliParser,
    private readonly runner: RunCliCommand,
    private readonly stdout: Stdout,
    private readonly stderr: Stderr,
    private readonly logger: Logger,
  ) {}

  /**
   * Runs one CLI invocation. `argv` is the slice of `process.argv`
   * AFTER `node script-name` (i.e. the first entry is the
   * sub-command name). The composition root computes the slice
   * before calling.
   */
  public async run(argv: readonly string[]): Promise<number> {
    let invocation;
    try {
      invocation = this.parser.parse(argv);
    } catch (err: unknown) {
      return this.handleParseError(err);
    }

    try {
      const output = await this.runner.run(invocation);
      if (output.stdout.length > 0) this.stdout.write(output.stdout);
      if (output.stderr.length > 0) this.stderr.write(output.stderr);
      return output.exitCode.toNumber();
    } catch (err: unknown) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        "CLI entrypoint caught uncaught error",
      );
      this.stderr.write(
        `Error: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      return ExitCode.from("genericError").toNumber();
    }
  }

  private handleParseError(err: unknown): number {
    if (err instanceof CliDomainError) {
      this.logger.warn(
        { code: err.code, err: err.message },
        "CLI parse failure",
      );
      this.stderr.write(`${err.message}\n`);
      return ExitCode.from("usageError").toNumber();
    }
    this.logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "CLI parser threw unexpectedly",
    );
    this.stderr.write(
      `Error de uso: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return ExitCode.from("usageError").toNumber();
  }
}
