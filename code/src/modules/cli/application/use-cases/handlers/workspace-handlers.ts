import type { Logger } from "../../../../../shared/application/ports/logger.port.ts";
import { InvariantViolationError } from "../../../../../shared/domain/errors/invariant-violation-error.ts";
import { CliDomainError } from "../../../domain/errors/cli-domain-error.ts";
import type { CommandOutput } from "../../../domain/value-objects/command-output.ts";
import { CommandOutput as CommandOutputClass } from "../../../domain/value-objects/command-output.ts";
import { ExitCode } from "../../../domain/value-objects/exit-code.ts";
import type {
  CliForgetKeyInvocation,
  CliHealthInvocation,
  CliInitInvocation,
  CliModeInvocation,
  CliUnlockInvocation,
} from "../../dtos/cli-invocation.dto.ts";
import type { CommandHandler } from "../../ports/in/command-handler.port.ts";
import type {
  ChangeModeFacade,
  HealthCheckFacade,
  InitializeWorkspaceFacade,
  LockWorkspaceFacade,
  UnlockWorkspaceFacade,
  WorkspaceModeWire,
} from "../../ports/out/workspace-facade.port.ts";
import type { Prompt } from "../../ports/out/tty.port.ts";
import { resolveRootPath } from "./root-path.ts";

/**
 * Raised when the user types two distinct passphrases at the
 * confirmation prompt. CLI-domain error so the dispatch maps it to
 * `usageError` exit code.
 */
export class PassphraseMismatchError extends CliDomainError {
  public readonly code = "cli.passphrase-mismatch";
  public readonly jsonRpcCode: number | null = null;

  public constructor() {
    super("las dos passphrases no coinciden");
  }
}

/**
 * Handler for `mcp-memoria init`.
 *
 * Behaviour per `docs/07-instalacion.md` §7 and
 * `docs/11-seguridad-modos.md` §§2-4:
 *   - When the user did not pick a mode, prompts interactively.
 *   - When `--mode encrypted`, prompts for a passphrase (twice for
 *     confirmation) and forwards it to the workspace facade.
 *   - In non-interactive mode requires a passphrase pre-supplied by
 *     the entrypoint adapter (typically via env var); raises an
 *     invariant violation otherwise.
 */
export class InitCommandHandler implements CommandHandler<"init"> {
  public readonly command = "init" as const;

  public constructor(
    private readonly facade: InitializeWorkspaceFacade,
    private readonly prompt: Prompt,
    private readonly logger: Logger,
  ) {}

  public async handle(invocation: CliInitInvocation): Promise<CommandOutput> {
    const rootPath = resolveRootPath(invocation.workspacePath);
    const mode = invocation.mode ?? (await this.askMode(invocation.nonInteractive));
    const displayName =
      invocation.displayName ??
      (await this.askDisplayName(invocation.nonInteractive));

    let passphrase: string | null = null;
    if (mode === "encrypted") {
      passphrase = await this.collectPassphrase(invocation.nonInteractive);
    }

    const result = await this.facade.initialize({
      rootPath,
      mode,
      displayName,
      passphrase,
    });

    this.logger.info(
      {
        workspaceId: result.workspaceId,
        mode: result.mode,
        wasCreated: result.wasCreated,
      },
      "init command completed",
    );

    const lines: string[] = [];
    if (result.wasCreated) {
      lines.push(`Workspace inicializado en modo "${result.mode}".`);
      lines.push(`Workspace ID: ${result.workspaceId}`);
    } else {
      lines.push(
        `Workspace ya existia en modo "${result.mode}". No se hicieron cambios.`,
      );
    }

    return CommandOutputClass.create({
      stdout: `${lines.join("\n")}\n`,
      stderr: "",
      exitCode: ExitCode.success(),
    });
  }

  private async askMode(
    nonInteractive: boolean,
  ): Promise<WorkspaceModeWire> {
    if (nonInteractive) return "shared";
    const answer = await this.prompt.readLine(
      "Modo de privacidad (shared|encrypted|private) [shared]: ",
    );
    const normalised = answer.trim().toLowerCase();
    if (normalised === "encrypted") return "encrypted";
    if (normalised === "private") return "private";
    return "shared";
  }

  private async askDisplayName(nonInteractive: boolean): Promise<string> {
    if (nonInteractive) return "Workspace";
    const answer = await this.prompt.readLine(
      "Nombre legible del workspace [Workspace]: ",
    );
    const trimmed = answer.trim();
    return trimmed.length === 0 ? "Workspace" : trimmed;
  }

  private async collectPassphrase(nonInteractive: boolean): Promise<string> {
    if (nonInteractive) {
      throw new InvariantViolationError(
        "encrypted init in non-interactive mode requires the passphrase via the entrypoint adapter (typically MCP_MEMORIA_PASSPHRASE)",
        { invariant: "cli.handler.passphrase-required" },
      );
    }
    const first = await this.prompt.readPassphrase(
      "Pega o ingresa la passphrase de cifrado: ",
    );
    const second = await this.prompt.readPassphrase("Confirma la passphrase: ");
    if (first !== second) throw new PassphraseMismatchError();
    return first;
  }
}

/**
 * Handler for `mcp-memoria mode <new>`.
 */
export class ModeCommandHandler implements CommandHandler<"mode"> {
  public readonly command = "mode" as const;

  public constructor(
    private readonly facade: ChangeModeFacade,
    private readonly prompt: Prompt,
    private readonly logger: Logger,
  ) {}

  public async handle(invocation: CliModeInvocation): Promise<CommandOutput> {
    const rootPath = resolveRootPath(invocation.workspacePath);
    let passphrase: string | null = null;
    if (invocation.newMode === "encrypted") {
      if (invocation.nonInteractive) {
        throw new InvariantViolationError(
          "transition to encrypted requires the passphrase via the entrypoint adapter",
          { invariant: "cli.handler.passphrase-required" },
        );
      }
      const first = await this.prompt.readPassphrase(
        "Pega o ingresa la nueva passphrase de cifrado: ",
      );
      const second = await this.prompt.readPassphrase(
        "Confirma la passphrase: ",
      );
      if (first !== second) throw new PassphraseMismatchError();
      passphrase = first;
    }

    const result = await this.facade.change({
      rootPath,
      newMode: invocation.newMode,
      passphrase,
    });

    this.logger.info(
      {
        workspaceId: result.workspaceId,
        newMode: result.newMode,
      },
      "mode command completed",
    );

    return CommandOutputClass.stdoutOnly(
      `Modo del workspace actualizado a "${result.newMode}".\n`,
    );
  }
}

/**
 * Handler for `mcp-memoria unlock`.
 */
export class UnlockCommandHandler implements CommandHandler<"unlock"> {
  public readonly command = "unlock" as const;

  public constructor(
    private readonly facade: UnlockWorkspaceFacade,
    private readonly prompt: Prompt,
    private readonly logger: Logger,
  ) {}

  public async handle(invocation: CliUnlockInvocation): Promise<CommandOutput> {
    const rootPath = resolveRootPath(invocation.workspacePath);
    let passphrase = invocation.passphrase;
    if (passphrase === null && !invocation.nonInteractive) {
      passphrase = await this.prompt.readPassphrase(
        "Pega la clave de cifrado: ",
      );
    }
    const result = await this.facade.unlock({ rootPath, passphrase });
    this.logger.info(
      {
        workspaceId: result.workspaceId,
        wasUnlocked: result.wasUnlocked,
        mode: result.mode,
      },
      "unlock command completed",
    );
    if (!result.wasUnlocked) {
      return CommandOutputClass.stdoutOnly(
        `Workspace ya estaba desbloqueado o no requiere desbloqueo (modo "${result.mode}").\n`,
      );
    }
    return CommandOutputClass.stdoutOnly(
      "Workspace desbloqueado. La clave persiste hasta que ejecutes 'mcp-memoria forget-key --workspace .'.\n",
    );
  }
}

/**
 * Handler for `mcp-memoria forget-key`.
 */
export class ForgetKeyCommandHandler implements CommandHandler<"forget-key"> {
  public readonly command = "forget-key" as const;

  public constructor(
    private readonly facade: LockWorkspaceFacade,
    private readonly logger: Logger,
  ) {}

  public async handle(
    invocation: CliForgetKeyInvocation,
  ): Promise<CommandOutput> {
    const rootPath = resolveRootPath(invocation.workspacePath);
    const result = await this.facade.lock({ rootPath });
    this.logger.info(
      { workspaceId: result.workspaceId, wasLocked: result.wasLocked },
      "forget-key command completed",
    );
    if (!result.wasLocked) {
      return CommandOutputClass.stdoutOnly(
        "Workspace ya estaba bloqueado o no requiere clave.\n",
      );
    }
    return CommandOutputClass.stdoutOnly(
      "Clave borrada del cache local. Ejecuta 'mcp-memoria unlock --workspace .' para volver a abrir el workspace.\n",
    );
  }
}

/**
 * Handler for `mcp-memoria health`.
 */
export class HealthCommandHandler implements CommandHandler<"health"> {
  public readonly command = "health" as const;

  public constructor(
    private readonly facade: HealthCheckFacade,
    private readonly logger: Logger,
  ) {}

  public async handle(invocation: CliHealthInvocation): Promise<CommandOutput> {
    const rootPath = resolveRootPath(invocation.workspacePath);
    const result = await this.facade.check({ rootPath });
    this.logger.debug(
      { healthy: result.healthy, checks: result.checks.length },
      "health command completed",
    );

    const lines: string[] = [];
    for (const entry of result.checks) {
      const marker =
        entry.status === "pass"
          ? "[OK]"
          : entry.status === "fail"
            ? "[FAIL]"
            : "[SKIP]";
      lines.push(`${marker} ${entry.id} — ${entry.message}`);
    }
    lines.push(`\nResultado: ${result.healthy ? "saludable" : "con fallos"}`);
    const exit = result.healthy
      ? ExitCode.success()
      : ExitCode.from("genericError");
    return CommandOutputClass.create({
      stdout: `${lines.join("\n")}\n`,
      stderr: "",
      exitCode: exit,
    });
  }
}
