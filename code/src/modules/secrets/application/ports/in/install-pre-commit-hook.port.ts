import type { Result } from "../../../../../shared/domain/types/result.ts";
import type { PathSanitizerError } from "../../../domain/errors/path-sanitizer-error.ts";
import type { PreCommitHookInstallReceipt } from "../out/pre-commit-hook-installer.port.ts";

/**
 * Driving (input) port: install the pre-commit git hook in a
 * workspace.
 *
 * Implements the "Capa 4 — Pre-commit hook opcional" flow documented
 * in `docs/11-seguridad-modos.md` §6. The use case forwards to the
 * driven `PreCommitHookInstaller` adapter and surfaces the receipt
 * (status + final hook path) so the CLI / MCP tool can produce a
 * precise message.
 */
export interface InstallPreCommitHook {
  install(input: {
    workspaceRoot: string;
    force?: boolean;
  }): Promise<Result<PreCommitHookInstallReceipt, PathSanitizerError>>;
}
