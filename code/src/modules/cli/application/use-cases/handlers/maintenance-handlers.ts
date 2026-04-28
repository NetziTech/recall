import type { Logger } from "../../../../../shared/application/ports/logger.port.ts";
import { InvariantViolationError } from "../../../../../shared/domain/errors/invariant-violation-error.ts";
import type { CommandOutput } from "../../../domain/value-objects/command-output.ts";
import { CommandOutput as CommandOutputClass } from "../../../domain/value-objects/command-output.ts";
import { ExitCode } from "../../../domain/value-objects/exit-code.ts";
import type {
  CliExportInvocation,
  CliImportHandoffInvocation,
  CliImportInvocation,
  CliServerInvocation,
  CliStatsInvocation,
  CliWipeInvocation,
} from "../../dtos/cli-invocation.dto.ts";
import type { CommandHandler } from "../../ports/in/command-handler.port.ts";
import type {
  ExportFacade,
  ImportFacade,
  ImportHandoffFacade,
  ServerFacade,
  StatsFacade,
  WipeFacade,
} from "../../ports/out/maintenance-facade.port.ts";
import type { Prompt } from "../../ports/out/tty.port.ts";
import { resolveRootPath } from "./root-path.ts";

/**
 * Handler for `recall import-handoff --handoff <file.md>`.
 */
export class ImportHandoffCommandHandler
  implements CommandHandler<"import-handoff">
{
  public readonly command = "import-handoff" as const;

  public constructor(
    private readonly facade: ImportHandoffFacade,
    private readonly logger: Logger,
  ) {}

  public async handle(
    invocation: CliImportHandoffInvocation,
  ): Promise<CommandOutput> {
    const rootPath = resolveRootPath(invocation.workspacePath);
    const result = await this.facade.importHandoff({
      rootPath,
      handoffPath: invocation.handoffPath,
    });
    this.logger.info(
      {
        decisions: result.importedDecisions,
        learnings: result.importedLearnings,
        skipped: result.skippedSections,
      },
      "import-handoff command completed",
    );
    const lines = [
      `Importadas ${String(result.importedDecisions)} decisiones y ${String(result.importedLearnings)} aprendizajes desde ${invocation.handoffPath}.`,
      `Secciones omitidas: ${String(result.skippedSections)}.`,
    ];
    return CommandOutputClass.stdoutOnly(`${lines.join("\n")}\n`);
  }
}

/**
 * Handler for `recall export --output <path>`.
 */
export class ExportCommandHandler implements CommandHandler<"export"> {
  public readonly command = "export" as const;

  public constructor(
    private readonly facade: ExportFacade,
    private readonly logger: Logger,
  ) {}

  public async handle(invocation: CliExportInvocation): Promise<CommandOutput> {
    const rootPath = resolveRootPath(invocation.workspacePath);
    const result = await this.facade.export({
      rootPath,
      outputPath: invocation.outputPath,
    });
    this.logger.info(
      { outputPath: result.outputPath, bytes: result.bytesWritten },
      "export command completed",
    );
    return CommandOutputClass.stdoutOnly(
      `Workspace exportado a ${result.outputPath} (${String(result.bytesWritten)} bytes).\n`,
    );
  }
}

/**
 * Handler for `recall import --input <path>`.
 */
export class ImportCommandHandler implements CommandHandler<"import"> {
  public readonly command = "import" as const;

  public constructor(
    private readonly facade: ImportFacade,
    private readonly logger: Logger,
  ) {}

  public async handle(invocation: CliImportInvocation): Promise<CommandOutput> {
    const rootPath = resolveRootPath(invocation.workspacePath);
    const result = await this.facade.import({
      rootPath,
      inputPath: invocation.inputPath,
    });
    this.logger.info(
      { inputPath: result.inputPath, rows: result.importedRows },
      "import command completed",
    );
    return CommandOutputClass.stdoutOnly(
      `Importadas ${String(result.importedRows)} filas desde ${result.inputPath}.\n`,
    );
  }
}

/**
 * Handler for `recall wipe --confirm`.
 *
 * Behaviour: requires the operator to type `WIPE` at the
 * confirmation prompt (or pass `--confirm` if non-interactive). The
 * facade actually removes the directory; this handler is responsible
 * for the safety gate.
 */
export class WipeCommandHandler implements CommandHandler<"wipe"> {
  public readonly command = "wipe" as const;

  public constructor(
    private readonly facade: WipeFacade,
    private readonly prompt: Prompt,
    private readonly logger: Logger,
  ) {}

  public async handle(invocation: CliWipeInvocation): Promise<CommandOutput> {
    const rootPath = resolveRootPath(invocation.workspacePath);
    let confirmed = invocation.confirm;
    if (!confirmed) {
      if (invocation.nonInteractive) {
        return CommandOutputClass.failure({
          stderr:
            "wipe sin --confirm en modo no-interactivo es un no-op por seguridad.\n",
          exitCode: ExitCode.from("usageError"),
        });
      }
      const typed = await this.prompt.readLine(
        `Esta operacion borrara ".recall/" bajo "${rootPath}". Escribe WIPE para confirmar: `,
      );
      confirmed = typed.trim() === "WIPE";
    }
    if (!confirmed) {
      return CommandOutputClass.failure({
        stderr: "Operacion cancelada (no se confirmo la eliminacion).\n",
        exitCode: ExitCode.from("usageError"),
      });
    }
    const result = await this.facade.wipe({ rootPath, confirmed });
    this.logger.info(
      { removedPath: result.removedPath },
      "wipe command completed",
    );
    return CommandOutputClass.stdoutOnly(
      `Workspace eliminado: ${result.removedPath}.\n`,
    );
  }
}

/**
 * Handler for `recall stats`. JSON-formatted output for easy
 * piping (`recall stats | jq ...`).
 */
export class StatsCommandHandler implements CommandHandler<"stats"> {
  public readonly command = "stats" as const;

  public constructor(
    private readonly facade: StatsFacade,
    private readonly logger: Logger,
  ) {}

  public async handle(invocation: CliStatsInvocation): Promise<CommandOutput> {
    const rootPath = resolveRootPath(invocation.workspacePath);
    const result = await this.facade.stats({ rootPath });
    this.logger.debug(
      { decisions: result.decisions },
      "stats command completed",
    );
    return CommandOutputClass.stdoutOnly(
      `${JSON.stringify(result, null, 2)}\n`,
    );
  }
}

/**
 * Handler for `recall server`. Launches the MCP stdio
 * transport. The handler returns when the server exits; the exit
 * code is forwarded.
 */
export class ServerCommandHandler implements CommandHandler<"server"> {
  public readonly command = "server" as const;

  public constructor(
    private readonly facade: ServerFacade,
    private readonly logger: Logger,
  ) {}

  public async handle(invocation: CliServerInvocation): Promise<CommandOutput> {
    const rootPath = resolveRootPath(invocation.workspacePath);
    if (!invocation.nonInteractive) {
      // The server is intended for stdio piping by the MCP client;
      // running interactively from a TTY is almost always a mistake
      // (the process becomes unresponsive). We tolerate it (the
      // user might be debugging) but log a warning.
      this.logger.warn(
        {},
        "recall server invoked from a TTY; this is usually wrong",
      );
    }
    let result;
    try {
      result = await this.facade.start({ rootPath });
    } catch (err: unknown) {
      throw new InvariantViolationError(
        `MCP server failed to start: ${err instanceof Error ? err.message : String(err)}`,
        { invariant: "cli.handler.server-start" },
      );
    }
    this.logger.info(
      { exitCode: result.exitCode },
      "server command completed",
    );
    return CommandOutputClass.create({
      stdout: "",
      stderr: "",
      exitCode: ExitCode.fromValue(result.exitCode),
    });
  }
}
