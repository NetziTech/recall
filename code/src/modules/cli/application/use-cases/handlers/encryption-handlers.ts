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
 * Handler for `recall export-key`. Pre-condition: workspace
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
 * Handler for `recall rekey` (ADR-005 Q2). Pre-condition: the
 * operator must supply the CURRENT passphrase plus the NEW one
 * (twice, for confirmation). Rotates the envelope list under the
 * `addEnvelope(new) → verify → removeEnvelope(old)` pattern; the
 * master key remains stable. See the use case JSDoc for the
 * documented limit ("rekey does NOT mitigate a master-key
 * compromise").
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
    // ADR-005 Q2: collect the current passphrase first so a wrong
    // value rejects the whole flow before any new envelope is
    // generated. Mirrors the add-key handler's pattern.
    const current = await this.prompt.readPassphrase(
      "Passphrase actual (unlock): ",
    );
    const first = await this.prompt.readPassphrase(
      "Pega la nueva passphrase para la rotacion: ",
    );
    const second = await this.prompt.readPassphrase("Confirma la passphrase: ");
    if (first !== second) throw new PassphraseMismatchError();
    const result = await this.facade.rekey({
      rootPath,
      currentPassphrase: current,
      newPassphrase: first,
      label: invocation.label,
    });
    this.logger.info(
      {
        workspaceId: result.workspaceId,
        newKeyId: result.newKeyId,
        removedCount: result.removedKeyIds.length,
      },
      "rekey command completed",
    );
    const lines = [
      `Rotacion completada. Nueva clave id: ${result.newKeyId}.`,
      `Sobres eliminados: ${result.removedKeyIds.length}.`,
      "",
      renderEncryptionKeyBanner(result.newKeyId),
    ];
    return CommandOutputClass.create({
      stdout: lines.join("\n"),
      stderr: "",
      exitCode: ExitCode.success(),
    });
  }
}

/**
 * Handler for `recall add-key` (v0.5+). Adds a secondary key
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
    // ADR-005 Q1: the current passphrase is collected at the CLI
    // boundary and forwarded to the facade. The facade runs
    // unlock(current) before the multi-key add so a wrong value
    // fails fast without mutating the envelope list.
    const current = await this.prompt.readPassphrase(
      "Passphrase actual (unlock): ",
    );
    const first = await this.prompt.readPassphrase(
      "Pega la nueva passphrase a agregar: ",
    );
    const second = await this.prompt.readPassphrase("Confirma la passphrase: ");
    if (first !== second) throw new PassphraseMismatchError();
    const result = await this.facade.add({
      rootPath,
      currentPassphrase: current,
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
