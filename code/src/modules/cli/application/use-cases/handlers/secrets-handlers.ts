import type { Logger } from "../../../../../shared/application/ports/logger.port.ts";
import type { CommandOutput } from "../../../domain/value-objects/command-output.ts";
import { CommandOutput as CommandOutputClass } from "../../../domain/value-objects/command-output.ts";
import { ExitCode } from "../../../domain/value-objects/exit-code.ts";
import type {
  CliAuditInvocation,
  CliInstallHookInvocation,
  CliSanitizeInvocation,
  CliUninstallHookInvocation,
} from "../../dtos/cli-invocation.dto.ts";
import type { CommandHandler } from "../../ports/in/command-handler.port.ts";
import type {
  AuditFacade,
  InstallHookFacade,
  SanitizeFacade,
  UninstallHookFacade,
} from "../../ports/out/secrets-facade.port.ts";
import { resolveRootPath } from "./root-path.ts";

/**
 * Handler for `recall audit`.
 *
 * Output format:
 *   - One line per finding, prefixed with the severity tag.
 *   - Last line is a summary count.
 *   - Exit code: `secretDetected` when any critical finding exists
 *     AND `--strict` was set; `genericError` for non-strict critical;
 *     `success` otherwise.
 */
export class AuditCommandHandler implements CommandHandler<"audit"> {
  public readonly command = "audit" as const;

  public constructor(
    private readonly facade: AuditFacade,
    private readonly logger: Logger,
  ) {}

  public async handle(invocation: CliAuditInvocation): Promise<CommandOutput> {
    const rootPath = resolveRootPath(invocation.workspacePath);
    const result = await this.facade.audit({
      rootPath,
      checkSecrets: invocation.checkSecrets,
      strict: invocation.strict,
    });
    this.logger.info(
      {
        findings: result.findings.length,
        hasCritical: result.hasCritical,
      },
      "audit command completed",
    );
    const lines: string[] = [];
    for (const f of result.findings) {
      lines.push(`[${f.severity.toUpperCase()}] ${f.kind} ${f.id}: ${f.summary}`);
    }
    lines.push("");
    lines.push(`Total: ${String(result.findings.length)} hallazgos.`);

    let exit: ExitCode;
    if (result.hasCritical && invocation.strict) {
      exit = ExitCode.from("secretDetected");
    } else if (result.hasCritical) {
      exit = ExitCode.from("genericError");
    } else {
      exit = ExitCode.success();
    }
    return CommandOutputClass.create({
      stdout: `${lines.join("\n")}\n`,
      stderr: "",
      exitCode: exit,
    });
  }
}

/**
 * Handler for `recall sanitize --entry-id <id>`.
 */
export class SanitizeCommandHandler implements CommandHandler<"sanitize"> {
  public readonly command = "sanitize" as const;

  public constructor(
    private readonly facade: SanitizeFacade,
    private readonly logger: Logger,
  ) {}

  public async handle(
    invocation: CliSanitizeInvocation,
  ): Promise<CommandOutput> {
    const rootPath = resolveRootPath(invocation.workspacePath);
    const result = await this.facade.sanitize({
      rootPath,
      entryId: invocation.entryId,
    });
    this.logger.info(
      { entryId: result.entryId, redacted: result.redactedPaths.length },
      "sanitize command completed",
    );
    return CommandOutputClass.stdoutOnly(
      `Entry ${result.entryId} sanitizada (${String(result.redactedPaths.length)} campos redactados).\n`,
    );
  }
}

/**
 * Handler for `recall install-hook`.
 */
export class InstallHookCommandHandler
  implements CommandHandler<"install-hook">
{
  public readonly command = "install-hook" as const;

  public constructor(
    private readonly facade: InstallHookFacade,
    private readonly logger: Logger,
  ) {}

  public async handle(
    invocation: CliInstallHookInvocation,
  ): Promise<CommandOutput> {
    const rootPath = resolveRootPath(invocation.workspacePath);
    const result = await this.facade.install({ rootPath });
    this.logger.info(
      { installedAt: result.installedAt },
      "install-hook command completed",
    );
    return CommandOutputClass.stdoutOnly(
      `Hook pre-commit instalado en ${result.installedAt}.\n`,
    );
  }
}

/**
 * Handler for `recall uninstall-hook`.
 */
export class UninstallHookCommandHandler
  implements CommandHandler<"uninstall-hook">
{
  public readonly command = "uninstall-hook" as const;

  public constructor(
    private readonly facade: UninstallHookFacade,
    private readonly logger: Logger,
  ) {}

  public async handle(
    invocation: CliUninstallHookInvocation,
  ): Promise<CommandOutput> {
    const rootPath = resolveRootPath(invocation.workspacePath);
    const result = await this.facade.uninstall({ rootPath });
    this.logger.info(
      { removedAt: result.removedAt },
      "uninstall-hook command completed",
    );
    if (result.removedAt === null) {
      return CommandOutputClass.stdoutOnly(
        "No habia hook pre-commit instalado.\n",
      );
    }
    return CommandOutputClass.stdoutOnly(
      `Hook pre-commit eliminado de ${result.removedAt}.\n`,
    );
  }
}
