import type { Logger } from "../../../../shared/application/ports/logger.port.ts";
import { InvariantViolationError } from "../../../../shared/domain/errors/invariant-violation-error.ts";
import type { CommandOutput } from "../../domain/value-objects/command-output.ts";
import { CommandOutput as CommandOutputClass } from "../../domain/value-objects/command-output.ts";
import { ExitCode } from "../../domain/value-objects/exit-code.ts";
import type { CliInvocation } from "../dtos/cli-invocation.dto.ts";
import type {
  CommandHandler,
  ErasedCommandHandler,
} from "../ports/in/command-handler.port.ts";
import type { RunCliCommand } from "../ports/in/run-cli-command.port.ts";

/**
 * Implements the `RunCliCommand` driving port.
 *
 * Strategy:
 *   - Builds a `Map<CommandName, ErasedCommandHandler>` from the
 *     registered handlers. Each handler is responsible for ONE
 *     command of the catalog (`docs/07-instalacion.md` §7).
 *   - Dispatches by `invocation.command`. The compile-time
 *     exhaustiveness check in `cli-invocation.dto.ts` guarantees
 *     the union covers every catalog entry.
 *   - Catches exceptions thrown by handlers, logs them, and
 *     returns a `CommandOutput` with `exitCode = genericError`. The
 *     entrypoint adapter inspects the exit code to decide
 *     `process.exit`.
 */
export class RunCliCommandUseCase implements RunCliCommand {
  private readonly handlers: Map<
    CliInvocation["command"],
    ErasedCommandHandler
  >;

  public constructor(
    handlers: readonly ErasedCommandHandler[],
    private readonly logger: Logger,
  ) {
    this.handlers = new Map();
    for (const handler of handlers) {
      if (this.handlers.has(handler.command)) {
        throw new InvariantViolationError(
          `duplicate CLI handler registered for command "${handler.command}"`,
          { invariant: "cli.handler.unique-per-command" },
        );
      }
      this.handlers.set(handler.command, handler);
    }
  }

  public async run(invocation: CliInvocation): Promise<CommandOutput> {
    const handler = this.handlers.get(invocation.command);
    if (handler === undefined) {
      this.logger.error(
        { command: invocation.command },
        "no handler registered for CLI command",
      );
      return CommandOutputClass.failure({
        stderr: `Internal error: no handler for command "${invocation.command}"\n`,
        exitCode: ExitCode.from("genericError"),
      });
    }
    try {
      return await handler.handle(invocation);
    } catch (err: unknown) {
      this.logger.error(
        {
          command: invocation.command,
          err: err instanceof Error ? err.message : String(err),
        },
        "CLI command threw",
      );
      return CommandOutputClass.failure({
        stderr: formatHandlerError(err),
        exitCode: classifyErrorAsExitCode(err),
      });
    }
  }
}

/**
 * Helper exported for the entrypoint adapter so it can wrap a
 * concrete `CommandHandler<T>` implementation as an
 * `ErasedCommandHandler` without an unsafe cast.
 *
 * The handler narrows the invocation via `Extract`; the eraser does
 * a runtime branch on `command` that the type system already
 * trusts (the discriminated union is sound).
 */
export function eraseHandler<TCommand extends CliInvocation["command"]>(
  handler: CommandHandler<TCommand>,
): ErasedCommandHandler {
  return {
    command: handler.command,
    handle(invocation: CliInvocation): Promise<CommandOutput> {
      if (invocation.command !== handler.command) {
        throw new InvariantViolationError(
          `eraseHandler routing mismatch: handler="${handler.command}", invocation="${invocation.command}"`,
          { invariant: "cli.handler.command-match" },
        );
      }
      return handler.handle(
        invocation as Extract<CliInvocation, { readonly command: TCommand }>,
      );
    },
  };
}

function formatHandlerError(err: unknown): string {
  if (err instanceof Error) {
    return `Error: ${err.message}\n`;
  }
  return `Error: ${String(err)}\n`;
}

/**
 * Maps a thrown error to a CLI exit code per the canonical table in
 * `command-name.ts`. The mapping is best-effort — most errors
 * surface as `genericError`.
 *
 * Pattern matching is by `code` string (every domain / infrastructure
 * error in the codebase carries a stable kebab-case code). Unknown
 * shapes fall through to `genericError`.
 */
function classifyErrorAsExitCode(err: unknown): ExitCode {
  if (typeof err !== "object" || err === null) {
    return ExitCode.from("genericError");
  }
  const candidate = err as { readonly code?: unknown };
  const code = candidate.code;
  if (typeof code !== "string") return ExitCode.from("genericError");

  if (code === "workspace.locked") return ExitCode.from("lockedWorkspace");
  if (code === "encryption.key-validation-failed") {
    return ExitCode.from("invalidKey");
  }
  if (code === "workspace.app.no-workspace-at-path") {
    return ExitCode.from("invalidConfig");
  }
  if (code === "workspace.config-missing" || code === "workspace.config-malformed") {
    return ExitCode.from("invalidConfig");
  }
  if (code === "secrets.detected" || code === "secret.detected") {
    return ExitCode.from("secretDetected");
  }
  if (code === "cli.invalid-command-args" || code === "cli.unknown-command") {
    return ExitCode.from("usageError");
  }
  return ExitCode.from("genericError");
}
