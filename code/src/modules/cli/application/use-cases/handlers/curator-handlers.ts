import type { Logger } from "../../../../../shared/application/ports/logger.port.ts";
import type { CommandOutput } from "../../../domain/value-objects/command-output.ts";
import { CommandOutput as CommandOutputClass } from "../../../domain/value-objects/command-output.ts";
import type {
  CliCuratorLogInvocation,
  CliCuratorRunInvocation,
} from "../../dtos/cli-invocation.dto.ts";
import type { CommandHandler } from "../../ports/in/command-handler.port.ts";
import type {
  CuratorLogFacade,
  CuratorRunFacade,
} from "../../ports/out/curator-facade.port.ts";
import { resolveRootPath } from "./root-path.ts";

/**
 * Handler for `recall curator-run [--dry-run]`.
 */
export class CuratorRunCommandHandler implements CommandHandler<"curator-run"> {
  public readonly command = "curator-run" as const;

  public constructor(
    private readonly facade: CuratorRunFacade,
    private readonly logger: Logger,
  ) {}

  public async handle(
    invocation: CliCuratorRunInvocation,
  ): Promise<CommandOutput> {
    const rootPath = resolveRootPath(invocation.workspacePath);
    const result = await this.facade.run({
      rootPath,
      dryRun: invocation.dryRun,
    });
    this.logger.info(
      {
        runId: result.runId,
        scanned: result.entriesScanned,
        pruned: result.entriesPruned,
      },
      "curator-run command completed",
    );

    const lines = [
      `Curator run ${result.runId} ${invocation.dryRun ? "(dry-run)" : ""}`,
      `  Entradas escaneadas: ${String(result.entriesScanned)}`,
      `  Entradas eliminadas: ${String(result.entriesPruned)}`,
      `  Aprendizajes consolidados: ${String(result.learningsConsolidated)}`,
      `  Duracion: ${String(result.durationMs)} ms`,
    ];
    return CommandOutputClass.stdoutOnly(`${lines.join("\n")}\n`);
  }
}

/**
 * Handler for `recall curator-log [--last <n>]`.
 */
export class CuratorLogCommandHandler implements CommandHandler<"curator-log"> {
  public readonly command = "curator-log" as const;

  public constructor(
    private readonly facade: CuratorLogFacade,
    private readonly logger: Logger,
  ) {}

  public async handle(
    invocation: CliCuratorLogInvocation,
  ): Promise<CommandOutput> {
    const rootPath = resolveRootPath(invocation.workspacePath);
    const result = await this.facade.log({
      rootPath,
      last: invocation.last,
    });
    this.logger.debug(
      { entries: result.entries.length },
      "curator-log command completed",
    );

    if (result.entries.length === 0) {
      return CommandOutputClass.stdoutOnly("Sin runs registrados.\n");
    }
    const lines: string[] = [];
    for (const e of result.entries) {
      const ended = e.endedAtMs === null ? "in-flight" : String(e.endedAtMs);
      lines.push(
        `${e.runId} trigger=${e.trigger} started=${String(e.startedAtMs)} ended=${ended} scanned=${String(e.entriesScanned)} pruned=${String(e.entriesPruned)}`,
      );
    }
    return CommandOutputClass.stdoutOnly(`${lines.join("\n")}\n`);
  }
}
