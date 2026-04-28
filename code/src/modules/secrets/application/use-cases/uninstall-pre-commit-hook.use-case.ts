import type { Logger } from "../../../../shared/application/ports/logger.port.ts";
import {
  isErr,
  type Result,
} from "../../../../shared/domain/types/result.ts";
import type { PathSanitizerError } from "../../domain/errors/path-sanitizer-error.ts";
import type { UninstallPreCommitHook } from "../ports/in/uninstall-pre-commit-hook.port.ts";
import type {
  PreCommitHookUninstallReceipt,
  PreCommitHookUninstaller,
} from "../ports/out/pre-commit-hook-uninstaller.port.ts";

/**
 * Use case: uninstall the pre-commit git hook from a workspace.
 *
 * Forwards to the `PreCommitHookUninstaller` driven port and surfaces
 * the receipt for the CLI / MCP tool. The use case adds:
 *
 * - A logging hook so operators see "hook removed at <path>" (or
 *   the appropriate idempotent / refusal variant) in the audit
 *   trail.
 * - A no-op for `Result` propagation (the `PathSanitizerError`
 *   channel passes through unchanged).
 *
 * Symmetric counterpart of `InstallPreCommitHookUseCase`.
 *
 * Why a class (not a free function): the composition root injects
 * the uninstaller + logger exactly once.
 */
export class UninstallPreCommitHookUseCase implements UninstallPreCommitHook {
  public constructor(
    private readonly uninstaller: PreCommitHookUninstaller,
    private readonly logger: Logger,
  ) {}

  public async uninstall(input: {
    workspaceRoot: string;
  }): Promise<Result<PreCommitHookUninstallReceipt, PathSanitizerError>> {
    const result = await this.uninstaller.uninstall(input);
    if (isErr(result)) {
      this.logger.warn(
        { kind: result.error.kind },
        "pre-commit hook uninstall rejected by path sanitizer",
      );
      return result;
    }
    this.logger.info(
      {
        hookPath: result.value.hookPath.toString(),
        status: result.value.status,
      },
      "pre-commit hook uninstalled",
    );
    return result;
  }
}
