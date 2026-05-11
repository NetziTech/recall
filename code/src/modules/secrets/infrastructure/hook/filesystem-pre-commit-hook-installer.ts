import { promises as fs } from "node:fs";
import path from "node:path";

import { err, ok, type Result } from "../../../../shared/domain/types/result.ts";
import type {
  PreCommitHookInstallReceipt,
  PreCommitHookInstaller,
} from "../../application/ports/out/pre-commit-hook-installer.port.ts";
import type { PreCommitHookInstallStatus } from "../../application/ports/out/pre-commit-hook-installer-status.guard.ts";
import type { PathSanitizerError } from "../../domain/errors/path-sanitizer-error.ts";
import type { PathSanitizerRule } from "../../domain/value-objects/path-sanitizer-rule.ts";
import type { SanitizedPath } from "../../domain/value-objects/sanitized-path.ts";
import { ForeignHookExistsError } from "../errors/foreign-hook-exists-error.ts";

/**
 * Marker line embedded in the hook script. The presence of this line
 * tells subsequent installs that the existing hook is managed by
 * THIS codebase (idempotent re-install). The text is intentionally
 * verbose so a human inspecting the hook file recognises its
 * provenance.
 */
export const MANAGED_HOOK_MARKER = "# managed-by: recall pre-commit hook v1";

/**
 * Block-delimiter markers wrapping the recall pre-commit content.
 *
 * Why two markers (legacy `MANAGED_HOOK_MARKER` AND the wrapped
 * delimiters):
 *
 *   - `MANAGED_HOOK_MARKER` is preserved for backwards-compatibility
 *     with hook files written by previous versions of recall that
 *     did NOT emit the wrapped delimiters. The uninstall adapter
 *     falls back to "remove the whole file" when only the legacy
 *     marker is present.
 *   - The wrapped `>>> ... <<<` delimiters let the uninstall adapter
 *     surgically remove just the recall block when the hook file
 *     is shared with other tooling (e.g. another framework's
 *     pre-commit shim concatenated by hand). The user can install +
 *     uninstall recall safely without losing their other hook
 *     contents.
 *
 * The literal strings are exported so the symmetric uninstaller
 * adapter consumes the SAME marker text without duplication.
 */
export const HOOK_BLOCK_BEGIN_MARKER = "# >>> recall pre-commit >>>";
export const HOOK_BLOCK_END_MARKER = "# <<< recall pre-commit <<<";

/**
 * Hook script content. Runs `recall` in `audit --check-secrets
 * --strict` mode against the staged files. The exit code of the CLI
 * tool determines whether the commit is allowed.
 *
 * The script is intentionally minimal: the actual scanning happens
 * inside the `recall` binary, which already owns the detector
 * registry and the workspace configuration. The hook is a thin
 * harness that calls into the binary and forwards its exit code.
 *
 * The shebang uses `/usr/bin/env bash` for portability across
 * Linux/macOS. Windows users either install Git for Windows (which
 * bundles bash) or use `recall audit` manually pre-commit.
 *
 * Layout (top → bottom):
 *   1. shebang line (must be first byte; the wrapped delimiters go
 *      AFTER it so the file remains a valid bash script).
 *   2. `HOOK_BLOCK_BEGIN_MARKER` — opening fence.
 *   3. `MANAGED_HOOK_MARKER` — legacy provenance marker.
 *   4. body (set -euo pipefail + the recall audit invocation).
 *   5. `HOOK_BLOCK_END_MARKER` — closing fence.
 */
const HOOK_SCRIPT = `#!/usr/bin/env bash
${HOOK_BLOCK_BEGIN_MARKER}
${MANAGED_HOOK_MARKER}
set -euo pipefail

if ! command -v recall >/dev/null 2>&1; then
  echo "recall pre-commit hook: 'recall' binary not found in PATH; skipping" >&2
  exit 0
fi

if ! recall audit --check-secrets --strict --workspace .; then
  echo "recall pre-commit hook: secrets detected in staged changes; commit blocked" >&2
  exit 1
fi

exit 0
${HOOK_BLOCK_END_MARKER}
`;

/**
 * Adapter that fulfils the `PreCommitHookInstaller` application port
 * by writing a hook file under `<workspaceRoot>/.git/hooks/pre-commit`.
 *
 * Algorithm:
 * 1. Sanitise `workspaceRoot` via `PathSanitizerRule.tildeRewrite`.
 *    The receipt carries the SANITISED path so log output stays
 *    free of usernames.
 * 2. Compute `<workspaceRoot>/.git/hooks/pre-commit` (using the raw
 *    absolute path internally).
 * 3. Inspect the existing file (if any):
 *    - Missing                       → write + chmod 0755.
 *    - Present + managed marker      → no-op (already-managed).
 *    - Present + foreign content     → if `force`, replace; else
 *                                      throw `ForeignHookExistsError`
 *                                      so the caller surfaces a
 *                                      precise message.
 * 4. Return a receipt with the sanitised hook path and the install
 *    status.
 *
 * Why we don't return `replaced-foreign` via the Result channel:
 * - The status itself is a SUCCESSFUL outcome (the hook was
 *   installed). The caller decides whether to surface it as a
 *   warning. Modeling it as an error would force the caller to
 *   branch twice for the same logical "install succeeded" path.
 *
 * Concurrency:
 * - The adapter is NOT re-entrant on the same workspace path. A
 *   second install in flight would race on the file write. The CLI
 *   serialises calls; the adapter does not add file-locking
 *   ceremony for the MVP.
 */
export class FilesystemPreCommitHookInstaller
  implements PreCommitHookInstaller {
  private readonly pathSanitizerRule: PathSanitizerRule;

  public constructor(options: {
    /**
     * Path-sanitiser rule applied to the workspace root for the
     * sanitised receipt. The composition root typically passes
     * `PathSanitizerRule.tildeRewrite(os.userInfo().username)`.
     */
    pathSanitizerRule: PathSanitizerRule;
  }) {
    this.pathSanitizerRule = options.pathSanitizerRule;
  }

  public async install(input: {
    workspaceRoot: string;
    force?: boolean;
  }): Promise<Result<PreCommitHookInstallReceipt, PathSanitizerError>> {
    // 1. Sanitise the workspace root. The sanitised form is what the
    //    receipt carries. The raw input is what we use to actually
    //    write the file.
    const sanitisedRoot = this.pathSanitizerRule.apply(input.workspaceRoot);
    if (sanitisedRoot.kind === "err") {
      return err(sanitisedRoot.error);
    }

    // 2. Compute the absolute hook path.
    const hookDir = path.join(input.workspaceRoot, ".git", "hooks");
    const hookFile = path.join(hookDir, "pre-commit");

    // 3. Inspect the existing hook (if any).
    let status: PreCommitHookInstallStatus = "installed";
    try {
      const existing = await fs.readFile(hookFile, "utf8");
      if (existing.includes(MANAGED_HOOK_MARKER)) {
        status = "already-managed";
      } else if (input.force === true) {
        status = "replaced-foreign";
      } else {
        // Refusing to silently overwrite a foreign hook is the
        // safe default. Throwing a typed error gives the caller a
        // precise hook to surface "your hook is managed by
        // <something else>; pass --force to overwrite".
        throw new ForeignHookExistsError(hookFile);
      }
    } catch (cause: unknown) {
      if (!isFileNotFound(cause)) {
        // Re-throw `ForeignHookExistsError` and any other unexpected
        // I/O error.
        throw cause;
      }
    }

    // 4. Make sure the hook directory exists. We do NOT create the
    //    `.git/` directory itself (a missing `.git/` means the
    //    workspace is not a git repo — the install is meaningless
    //    in that case). If the directory does not exist we let the
    //    underlying `mkdir`/`writeFile` throw a stable
    //    `ENOENT`/`ENOTDIR`; the composition root catches and
    //    surfaces a precise message.
    if (status !== "already-managed") {
      await fs.mkdir(hookDir, { recursive: true });
      // SAFE — SonarQube S2612: 0o755 (rwxr-xr-x) is REQUIRED for
      // git hooks to be executable. Git invokes `pre-commit` as an
      // executable script; without the execute bit on owner/group/
      // others, git silently skips the hook (defeating the entire
      // secret-scanning purpose). The file contains NO secrets — it
      // is a thin shim that calls `recall audit`. The world-
      // read bit is needed because git may run hooks under a
      // different effective UID inside CI containers. No write bit
      // is granted to group/others, so untrusted users on the host
      // cannot tamper with the hook script.
      await fs.writeFile(hookFile, HOOK_SCRIPT, {
        encoding: "utf8",
        mode: 0o755, // NOSONAR: see SAFE comment above (S2612).
      });
      // `writeFile` does not always honour the mode on some FSes
      // (overlayfs, ntfs); chmod explicitly to be safe.
      await fs.chmod(hookFile, 0o755); // NOSONAR: see SAFE comment above (S2612).
    }

    const receiptPath = this.makeReceiptPath(sanitisedRoot.value, hookFile);
    return ok({
      hookPath: receiptPath,
      status,
    });
  }

  /**
   * Builds the receipt's `SanitizedPath` from the sanitised
   * workspace root + the relative hook path. We recompute via
   * `PathSanitizerRule.apply` so the resulting `SanitizedPath`
   * carries its own invariants (no `..`, no NUL, length cap).
   */
  private makeReceiptPath(
    sanitisedRoot: SanitizedPath,
    absoluteHookPath: string,
  ): SanitizedPath {
    // Concatenate the sanitised root + the relative `.git/hooks/pre-commit`
    // suffix. `path.posix.join` keeps separators consistent
    // regardless of the host platform; the validator inside
    // `PathSanitizerRule` is OS-agnostic.
    const root = sanitisedRoot.toString();
    const suffix = path.posix.join(".git", "hooks", "pre-commit");
    const absoluteSanitised = root.endsWith("/")
      ? `${root}${suffix}`
      : `${root}/${suffix}`;

    // The path may still contain absolute-prefix bytes if
    // `tildeRewrite` had no rule applicable (e.g. test workspaces
    // outside `/Users/<x>`). Apply the rule ONCE more to wrap the
    // value in a `SanitizedPath`. Errors here mean a programmer
    // bug (the hook path was assembled inconsistently); we throw
    // because there is no Result channel from this private helper.
    const wrapped = this.pathSanitizerRule.apply(absoluteSanitised);
    if (wrapped.kind === "err") {
      throw new Error(
        `internal error: cannot wrap sanitised hook path in SanitizedPath: ${wrapped.error.message}`,
      );
    }
    // Defensive use of the absolute path is also kept available; we
    // narrow to the void return so the unused identifier does not
    // trip lint rules.
    void absoluteHookPath;
    return wrapped.value;
  }
}

function isFileNotFound(cause: unknown): boolean {
  if (typeof cause !== "object" || cause === null) return false;
  if (!("code" in cause)) return false;
  return Reflect.get(cause, "code") === "ENOENT";
}
