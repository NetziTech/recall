import type { Logger } from "../../../../../shared/application/ports/logger.port.ts";
import { InvariantViolationError } from "../../../../../shared/domain/errors/invariant-violation-error.ts";
import type { CommandOutput } from "../../../domain/value-objects/command-output.ts";
import { CommandOutput as CommandOutputClass } from "../../../domain/value-objects/command-output.ts";
import { ExitCode } from "../../../domain/value-objects/exit-code.ts";
import type {
  CliAddKeyInvocation,
  CliExportKeyInvocation,
  CliRekeyInvocation,
} from "../../dtos/cli-invocation.dto.ts";
import type { CommandHandler } from "../../ports/in/command-handler.port.ts";
import type {
  AddKeyFacade,
  ExportKeyFacade,
  RekeyFacade,
} from "../../ports/out/encryption-facade.port.ts";
import type { Prompt } from "../../ports/out/tty.port.ts";
import { renderEncryptionKeyBanner } from "./encryption-key-banner.ts";
import { PassphraseMismatchError } from "./workspace-handlers.ts";
import { resolveRootPath } from "./root-path.ts";

/**
 * Handler for `mcp-memoria export-key`. Pre-condition: workspace
 * must be unlocked. The facade refuses on locked workspaces and
 * the dispatch maps the resulting domain error to
 * `lockedWorkspace` exit code.
 */
export class ExportKeyCommandHandler implements CommandHandler<"export-key"> {
  public readonly command = "export-key" as const;

  public constructor(
    private readonly facade: ExportKeyFacade,
    private readonly logger: Logger,
  ) {}

  public async handle(
    invocation: CliExportKeyInvocation,
  ): Promise<CommandOutput> {
    const rootPath = resolveRootPath(invocation.workspacePath);
    const result = await this.facade.export({ rootPath });
    this.logger.info(
      { workspaceId: result.workspaceId },
      "export-key command completed",
    );
    return CommandOutputClass.stdoutOnly(
      renderEncryptionKeyBanner(result.printableKey),
    );
  }
}

/**
 * Handler for `mcp-memoria rekey` (v0.5+). Pre-condition: workspace
 * unlocked. Generates a new master key and re-ciphers every envelope.
 */
export class RekeyCommandHandler implements CommandHandler<"rekey"> {
  public readonly command = "rekey" as const;

  public constructor(
    private readonly facade: RekeyFacade,
    private readonly prompt: Prompt,
    private readonly logger: Logger,
  ) {}

  public async handle(invocation: CliRekeyInvocation): Promise<CommandOutput> {
    const rootPath = resolveRootPath(invocation.workspacePath);
    if (invocation.nonInteractive) {
      throw new InvariantViolationError(
        "rekey requires a confirmation prompt; non-interactive mode not supported",
        { invariant: "cli.handler.passphrase-required" },
      );
    }
    const first = await this.prompt.readPassphrase(
      "Pega la nueva passphrase para reciframiento: ",
    );
    const second = await this.prompt.readPassphrase("Confirma la passphrase: ");
    if (first !== second) throw new PassphraseMismatchError();
    const result = await this.facade.rekey({ rootPath, newPassphrase: first });
    this.logger.info(
      { workspaceId: result.workspaceId },
      "rekey command completed",
    );
    return CommandOutputClass.stdoutOnly(
      renderEncryptionKeyBanner(result.printableKey),
    );
  }
}

/**
 * Handler for `mcp-memoria add-key` (v0.5+). Adds a secondary key
 * envelope without invalidating the existing one.
 */
export class AddKeyCommandHandler implements CommandHandler<"add-key"> {
  public readonly command = "add-key" as const;

  public constructor(
    private readonly facade: AddKeyFacade,
    private readonly prompt: Prompt,
    private readonly logger: Logger,
  ) {}

  public async handle(invocation: CliAddKeyInvocation): Promise<CommandOutput> {
    const rootPath = resolveRootPath(invocation.workspacePath);
    if (invocation.nonInteractive) {
      throw new InvariantViolationError(
        "add-key requires a confirmation prompt; non-interactive mode not supported",
        { invariant: "cli.handler.passphrase-required" },
      );
    }
    const first = await this.prompt.readPassphrase(
      "Pega la nueva passphrase a agregar: ",
    );
    const second = await this.prompt.readPassphrase("Confirma la passphrase: ");
    if (first !== second) throw new PassphraseMismatchError();
    const result = await this.facade.add({
      rootPath,
      newPassphrase: first,
      label: invocation.label,
    });
    this.logger.info(
      { workspaceId: result.workspaceId, keyId: result.keyId },
      "add-key command completed",
    );

    const lines = [
      `Nueva clave agregada (key id: ${result.keyId}).`,
      "",
      renderEncryptionKeyBanner(result.printableKey),
    ];
    return CommandOutputClass.create({
      stdout: lines.join("\n"),
      stderr: "",
      exitCode: ExitCode.success(),
    });
  }
}
