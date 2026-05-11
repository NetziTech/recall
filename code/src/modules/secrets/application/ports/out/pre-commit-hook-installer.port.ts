import type { Result } from "../../../../../shared/domain/types/result.ts";
import type { SanitizedPath } from "../../../domain/value-objects/sanitized-path.ts";
import type { PathSanitizerError } from "../../../domain/errors/path-sanitizer-error.ts";
import type { PreCommitHookInstallStatus } from "./pre-commit-hook-installer-status.guard.ts";

/**
 * Outcome of a successful `install(...)` call.
 */
export interface PreCommitHookInstallReceipt {
  readonly hookPath: SanitizedPath;
  readonly status: PreCommitHookInstallStatus;
}

/**
 * Driven (output) port that installs the project-managed
 * `pre-commit` git hook described in `docs/11-seguridad-modos.md` §6
 * ("Capa 4 — Pre-commit hook opcional").
 *
 * The installed hook scans the staged changes via the secrets
 * scanner before allowing a commit. The hook content is the adapter's
 * concern; this port only carries the install / detection contract.
 *
 * Contract:
 * - `install(workspaceRoot)` writes the hook to
 *   `<workspaceRoot>/.git/hooks/pre-commit` and marks it executable
 *   (`0755`).
 * - The adapter MUST refuse a `workspaceRoot` whose path traversal
 *   policy is rejected by `PathSanitizerRule` (encoded as a
 *   `PathSanitizerError` in the `Result` channel). The adapter MAY
 *   also refuse a workspace that is not a git repository
 *   (typically: surfaces an `Error` with a stable code via the
 *   throws side; the brief leaves the precise mapping to the
 *   adapter author).
 * - The adapter MUST embed a managed-by marker in the hook script
 *   content so subsequent installs detect the existing managed
 *   hook (`already-managed`) and refuse to overwrite a foreign hook
 *   silently (`replaced-foreign` only when the caller opts in via
 *   the `force` flag).
 *
 * Security:
 * - The adapter never reads the contents of an existing hook beyond
 *   the managed-by marker line. Foreign hooks may legitimately
 *   contain user secrets in environment variables or paths; the
 *   adapter must not leak them.
 * - The hook content emitted by the adapter MUST run inside the
 *   workspace's environment (no global PATH manipulation, no
 *   `set -x`).
 */
export interface PreCommitHookInstaller {
  /**
   * Installs the pre-commit hook in the given workspace's `.git/hooks/`
   * directory.
   *
   * @param input.workspaceRoot - the canonicalised root of the git
   *   workspace. The adapter prepends `.git/hooks/pre-commit` and
   *   wraps the result in a `SanitizedPath`.
   * @param input.force - when `true`, the adapter overwrites a
   *   foreign hook (returns `replaced-foreign`). When `false` (or
   *   omitted) and a foreign hook is present, the adapter throws
   *   so the caller can surface a precise message.
   */
  install(input: {
    workspaceRoot: string;
    force?: boolean;
  }): Promise<Result<PreCommitHookInstallReceipt, PathSanitizerError>>;

  /**
   * Type guard exposed for callers that need to validate the install
   * status without instantiating the receipt.
   */
  isStatus?(candidate: string): candidate is PreCommitHookInstallStatus;
}
