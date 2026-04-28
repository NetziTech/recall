import type { Result } from "../../../../../shared/domain/types/result.ts";
import type { SanitizedPath } from "../../../domain/value-objects/sanitized-path.ts";
import type { PathSanitizerError } from "../../../domain/errors/path-sanitizer-error.ts";

/**
 * Set of legal `PreCommitHookUninstallStatus` values describing the
 * outcome of an `uninstall(...)` call.
 *
 * - `not-installed`: there was no `pre-commit` hook file at all.
 *   Idempotent no-op.
 * - `not-managed`: a `pre-commit` hook file existed but does NOT
 *   carry the recall managed-by marker. The adapter refuses to
 *   touch a foreign hook (conservative policy mirroring the install
 *   side, which refuses to silently overwrite).
 * - `removed`: a recall-managed hook existed and was removed
 *   entirely (the file lived only to host the recall block).
 * - `block-removed`: a hook file existed which mixed recall content
 *   with foreign content (block delimited by
 *   `# >>> recall pre-commit >>>` ... `# <<< recall pre-commit <<<`)
 *   and only the recall block was excised. The rest of the file is
 *   preserved verbatim and the executable bit is kept.
 */
const PRE_COMMIT_HOOK_UNINSTALL_STATUSES = [
  "not-installed",
  "not-managed",
  "removed",
  "block-removed",
] as const;

export type PreCommitHookUninstallStatus =
  (typeof PRE_COMMIT_HOOK_UNINSTALL_STATUSES)[number];

/**
 * Outcome of a successful `uninstall(...)` call.
 *
 * Note: `hookPath` is the SANITISED path of the hook file the
 * uninstall acted on (or would have acted on, in the
 * `not-installed` / `not-managed` cases). Callers can use it for
 * messaging without further sanitisation.
 */
export interface PreCommitHookUninstallReceipt {
  readonly hookPath: SanitizedPath;
  readonly status: PreCommitHookUninstallStatus;
}

/**
 * Driven (output) port that uninstalls the project-managed
 * `pre-commit` git hook. Symmetric counterpart of
 * `PreCommitHookInstaller`.
 *
 * Contract:
 * - `uninstall(workspaceRoot)` removes (or partially edits) the
 *   hook at `<workspaceRoot>/.git/hooks/pre-commit`.
 * - The adapter MUST refuse a `workspaceRoot` whose path traversal
 *   policy is rejected by `PathSanitizerRule` (encoded as a
 *   `PathSanitizerError` in the `Result` channel).
 * - The adapter MUST NOT mutate a hook file whose content is foreign
 *   (no recall marker present). The `not-managed` status is the
 *   conservative answer; the operator must remove the file by hand
 *   if they want it gone.
 * - The adapter detects the recall block in two flavours:
 *     1. Wrapped block — the file contains both
 *        `# >>> recall pre-commit >>>` and `# <<< recall pre-commit <<<`
 *        with the legacy `# managed-by: recall pre-commit hook v1`
 *        marker between them. Only the wrapped section is excised.
 *        If the surviving content is empty/whitespace-only, the file
 *        is removed entirely (the partial-removal status is still
 *        `block-removed` in this case to surface that the file did
 *        contain other markers; callers that need finer granularity
 *        can inspect the resulting file themselves).
 *     2. Legacy monolithic — the file contains the
 *        `# managed-by: recall pre-commit hook v1` marker but NOT
 *        the wrapped delimiters. The whole file is removed
 *        (`removed`). This branch keeps backward-compatibility with
 *        hooks installed by previous versions of recall that did
 *        not yet write the wrapped delimiters.
 *
 * Security:
 * - The adapter never reads beyond the markers it needs to detect
 *   the managed block. Foreign hooks may legitimately contain user
 *   secrets in environment variables; the adapter must not leak
 *   them via logs or receipts.
 * - The adapter must NOT change the executable bit of a hook it
 *   leaves on disk (the `block-removed` case): the surrounding
 *   foreign content may rely on the existing mode.
 */
export interface PreCommitHookUninstaller {
  /**
   * Removes the pre-commit hook (or its recall-managed block) from
   * the given workspace's `.git/hooks/` directory.
   *
   * @param input.workspaceRoot - the canonicalised root of the git
   *   workspace. The adapter prepends `.git/hooks/pre-commit` and
   *   wraps the result in a `SanitizedPath`.
   */
  uninstall(input: {
    workspaceRoot: string;
  }): Promise<Result<PreCommitHookUninstallReceipt, PathSanitizerError>>;

  /**
   * Type guard exposed for callers that need to validate the
   * uninstall status without instantiating the receipt.
   */
  isStatus?(candidate: string): candidate is PreCommitHookUninstallStatus;
}

/**
 * Type guard helper exported as a free function so consumers can
 * narrow status strings without instantiating an uninstaller adapter.
 *
 * Lives next to the union to keep the source of truth compact.
 */
export function isPreCommitHookUninstallStatus(
  candidate: string,
): candidate is PreCommitHookUninstallStatus {
  for (const known of PRE_COMMIT_HOOK_UNINSTALL_STATUSES) {
    if (known === candidate) return true;
  }
  return false;
}
