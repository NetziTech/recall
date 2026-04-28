import type { Logger } from "../../../../shared/application/ports/logger.port.ts";
import {
  isErr,
  type Result,
} from "../../../../shared/domain/types/result.ts";
import type { PathSanitizerError } from "../../domain/errors/path-sanitizer-error.ts";
import type { InstallPreCommitHook } from "../ports/in/install-pre-commit-hook.port.ts";
import type {
  PreCommitHookInstallReceipt,
  PreCommitHookInstaller,
} from "../ports/out/pre-commit-hook-installer.port.ts";

/**
 * Use case: install the pre-commit git hook in a workspace.
 *
 * Forwards to the `PreCommitHookInstaller` driven port and surfaces
 * the receipt for the CLI / MCP tool. The use case adds:
 *
 * - A logging hook so operators see "hook installed at <path>" in
 *   the audit trail.
 * - A no-op for `Result` propagation (the `PathSanitizerError`
 *   channel passes through unchanged).
 *
 * Why a class (not a free function): the composition root injects
 * the installer + logger exactly once.
 */
export class InstallPreCommitHookUseCase implements InstallPreCommitHook {
  public constructor(
    private readonly installer: PreCommitHookInstaller,
    private readonly logger: Logger,
  ) {}

  public async install(input: {
    workspaceRoot: string;
    force?: boolean;
  }): Promise<Result<PreCommitHookInstallReceipt, PathSanitizerError>> {
    const result = await this.installer.install(input);
    if (isErr(result)) {
      this.logger.warn(
        { kind: result.error.kind },
        "pre-commit hook install rejected by path sanitizer",
      );
      return result;
    }
    this.logger.info(
      {
        hookPath: result.value.hookPath.toString(),
        status: result.value.status,
      },
      "pre-commit hook installed",
    );
    return result;
  }
}
