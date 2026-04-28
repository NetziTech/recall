import type { Result } from "../../../../../shared/domain/types/result.ts";
import type { PathSanitizerError } from "../../../domain/errors/path-sanitizer-error.ts";
import type { PreCommitHookUninstallReceipt } from "../out/pre-commit-hook-uninstaller.port.ts";

/**
 * Driving (input) port: uninstall the pre-commit git hook from a
 * workspace.
 *
 * Implements the symmetric counterpart of `InstallPreCommitHook`,
 * documented in `docs/11-seguridad-modos.md` §6 "Capa 4 — Pre-commit
 * hook opcional". The use case forwards to the driven
 * `PreCommitHookUninstaller` adapter and surfaces the receipt
 * (status + final hook path) so the CLI / MCP tool can produce a
 * precise message.
 *
 * The contract is intentionally idempotent: re-running the use case
 * on a workspace whose hook has already been uninstalled (or never
 * had one) returns successfully with a status that the caller maps
 * to the appropriate user-facing message.
 */
export interface UninstallPreCommitHook {
  uninstall(input: {
    workspaceRoot: string;
  }): Promise<Result<PreCommitHookUninstallReceipt, PathSanitizerError>>;
}
