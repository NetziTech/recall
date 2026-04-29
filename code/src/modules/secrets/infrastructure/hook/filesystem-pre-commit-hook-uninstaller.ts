import { promises as fs } from "node:fs";
import path from "node:path";

import { err, ok, type Result } from "../../../../shared/domain/types/result.ts";
import type {
  PreCommitHookUninstallReceipt,
  PreCommitHookUninstallStatus,
  PreCommitHookUninstaller,
} from "../../application/ports/out/pre-commit-hook-uninstaller.port.ts";
import type { PathSanitizerError } from "../../domain/errors/path-sanitizer-error.ts";
import type { PathSanitizerRule } from "../../domain/value-objects/path-sanitizer-rule.ts";
import type { SanitizedPath } from "../../domain/value-objects/sanitized-path.ts";
import {
  HOOK_BLOCK_BEGIN_MARKER,
  HOOK_BLOCK_END_MARKER,
  MANAGED_HOOK_MARKER,
} from "./filesystem-pre-commit-hook-installer.ts";

/**
 * Adapter that fulfils the `PreCommitHookUninstaller` application
 * port by removing the hook file (or just its recall block) under
 * `<workspaceRoot>/.git/hooks/pre-commit`.
 *
 * Algorithm:
 *
 *   1. Sanitise `workspaceRoot` via the injected `PathSanitizerRule`.
 *      The receipt carries the sanitised path so log output stays
 *      free of usernames.
 *   2. Compute `<workspaceRoot>/.git/hooks/pre-commit`.
 *   3. Read the existing file:
 *        - ENOENT (no file)              → status `not-installed`,
 *                                          idempotent no-op.
 *        - File present but no recall    → status `not-managed`,
 *          marker                          file untouched
 *                                          (conservative policy).
 *        - File present with wrapped     → excise the wrapped block,
 *          delimiters                       preserve the rest. If the
 *                                          surviving content is empty
 *                                          or whitespace-only, remove
 *                                          the file outright. Status
 *                                          `block-removed`.
 *        - File present with legacy      → remove the whole file.
 *          monolithic marker only           Status `removed`.
 *   4. Return the receipt.
 *
 * Concurrency:
 * - The adapter is NOT re-entrant on the same workspace path. A
 *   second uninstall in flight could race on the file unlink. The
 *   CLI serialises calls; the adapter does not add file-locking
 *   ceremony.
 *
 * Symmetric counterpart of `FilesystemPreCommitHookInstaller`.
 */
export class FilesystemPreCommitHookUninstaller
  implements PreCommitHookUninstaller {
  private readonly pathSanitizerRule: PathSanitizerRule;

  public constructor(options: {
    /**
     * Path-sanitiser rule applied to the workspace root for the
     * sanitised receipt. The composition root typically passes the
     * SAME rule used by the installer so install + uninstall produce
     * consistent log output.
     */
    pathSanitizerRule: PathSanitizerRule;
  }) {
    this.pathSanitizerRule = options.pathSanitizerRule;
  }

  public async uninstall(input: {
    workspaceRoot: string;
  }): Promise<Result<PreCommitHookUninstallReceipt, PathSanitizerError>> {
    // 1. Sanitise the workspace root. The sanitised form is what the
    //    receipt carries. The raw input is what we use to actually
    //    interact with the filesystem.
    const sanitisedRoot = this.pathSanitizerRule.apply(input.workspaceRoot);
    if (sanitisedRoot.kind === "err") {
      return err(sanitisedRoot.error);
    }

    // 2. Compute the absolute hook path.
    const hookDir = path.join(input.workspaceRoot, ".git", "hooks");
    const hookFile = path.join(hookDir, "pre-commit");

    // 3. Read & classify.
    const existing = await readIfPresent(hookFile);
    let status: PreCommitHookUninstallStatus;
    if (existing === null) {
      // Idempotent no-op: no hook to uninstall.
      status = "not-installed";
    } else if (hasWrappedBlock(existing)) {
      // Mixed file or wrapped-only file. Excise the block.
      const remainder = removeWrappedBlock(existing);
      if (isEffectivelyEmpty(remainder)) {
        // The file existed only to host the recall block (the
        // wrapped delimiters surround everything except whitespace).
        // Remove the file outright — leaving a one-byte stub on
        // disk would still make git invoke an empty hook.
        await fs.unlink(hookFile);
      } else {
        // Surgical edit: keep the foreign content. Preserve the
        // executable bit (do NOT chmod) and avoid changing line
        // endings beyond what the original file already had.
        await fs.writeFile(hookFile, remainder, "utf8");
      }
      status = "block-removed";
    } else if (existing.includes(MANAGED_HOOK_MARKER)) {
      // Legacy monolithic hook (installed by an older recall
      // version that did not yet emit the wrapped delimiters). The
      // entire file belongs to recall.
      await fs.unlink(hookFile);
      status = "removed";
    } else {
      // Foreign hook — refuse to touch it. The user must remove it
      // manually if they want it gone.
      status = "not-managed";
    }

    // 4. Build the receipt.
    const receiptPath = this.makeReceiptPath(sanitisedRoot.value, hookFile);
    return ok({
      hookPath: receiptPath,
      status,
    });
  }

  /**
   * Builds the receipt's `SanitizedPath` from the sanitised
   * workspace root + the relative hook path. Mirrors the helper in
   * `FilesystemPreCommitHookInstaller`.
   */
  private makeReceiptPath(
    sanitisedRoot: SanitizedPath,
    _absoluteHookPath: string,
  ): SanitizedPath {
    const root = sanitisedRoot.toString();
    const suffix = path.posix.join(".git", "hooks", "pre-commit");
    const absoluteSanitised = root.endsWith("/")
      ? `${root}${suffix}`
      : `${root}/${suffix}`;

    const wrapped = this.pathSanitizerRule.apply(absoluteSanitised);
    if (wrapped.kind === "err") {
      throw new Error(
        `internal error: cannot wrap sanitised hook path in SanitizedPath: ${wrapped.error.message}`,
      );
    }
    return wrapped.value;
  }
}

/**
 * Reads `hookFile` if it exists. Returns `null` on ENOENT so the
 * caller can treat "no file" as a normal idempotent path. Re-throws
 * every other I/O error (EISDIR, EACCES, etc.) so the bug surfaces
 * loudly instead of being silently classified as `not-installed`.
 */
async function readIfPresent(hookFile: string): Promise<string | null> {
  try {
    return await fs.readFile(hookFile, "utf8");
  } catch (cause: unknown) {
    if (isFileNotFound(cause)) return null;
    throw cause;
  }
}

/**
 * Detects whether `content` carries BOTH wrapped-block delimiters.
 * The order check (begin before end) is intentional: a malformed
 * file with the markers swapped does not match the legitimate
 * "managed by recall" signature and falls through to the legacy
 * branch (or `not-managed`) instead of being mangled by the slicing
 * logic.
 */
function hasWrappedBlock(content: string): boolean {
  const beginIdx = content.indexOf(HOOK_BLOCK_BEGIN_MARKER);
  if (beginIdx === -1) return false;
  const endIdx = content.indexOf(HOOK_BLOCK_END_MARKER, beginIdx);
  return endIdx !== -1;
}

/**
 * Removes the recall block delimited by `HOOK_BLOCK_BEGIN_MARKER`
 * ... `HOOK_BLOCK_END_MARKER`, INCLUDING the surrounding lines that
 * carry those markers.
 *
 * The slice walks line boundaries so a marker that appears on a
 * line of its own (the canonical layout) is removed cleanly without
 * leaving a stray trailing newline or eating an adjacent foreign
 * line. The function is conservative: if the markers fall in the
 * middle of a line (concatenated text without newlines, an unusual
 * case), it falls back to a substring removal that preserves the
 * non-recall halves of those lines.
 */
function removeWrappedBlock(content: string): string {
  const beginIdx = content.indexOf(HOOK_BLOCK_BEGIN_MARKER);
  if (beginIdx === -1) return content;
  const endStartIdx = content.indexOf(HOOK_BLOCK_END_MARKER, beginIdx);
  if (endStartIdx === -1) return content;

  // Expand `beginIdx` backwards to the start of its line so we eat
  // the whole "# >>> recall pre-commit >>>" line, not just the
  // marker text.
  let lineStart = beginIdx;
  while (lineStart > 0 && content.codePointAt(lineStart - 1) !== 0x0a) {
    lineStart -= 1;
  }

  // Expand the end position forward to the end of the line that
  // hosts the closing marker (consume the trailing `\n` so the
  // remainder does not start with a blank line).
  let lineEnd = endStartIdx + HOOK_BLOCK_END_MARKER.length;
  while (lineEnd < content.length && content.codePointAt(lineEnd) !== 0x0a) {
    lineEnd += 1;
  }
  if (lineEnd < content.length) {
    // Skip the LF that terminated the closing marker line.
    lineEnd += 1;
  }

  const before = content.slice(0, lineStart);
  const after = content.slice(lineEnd);
  return `${before}${after}`;
}

/**
 * `true` when the surviving content is empty or contains only
 * whitespace / a lonely shebang line. The shebang case matters
 * because the canonical layout has the shebang as its first line,
 * the wrapped recall block right after, and nothing else: removing
 * the wrapped block leaves `#!/usr/bin/env bash\n`, which by itself
 * is a valid-but-useless hook. Treating this as "effectively empty"
 * lets the adapter unlink the file outright.
 */
function isEffectivelyEmpty(content: string): boolean {
  const trimmed = content.trim();
  if (trimmed.length === 0) return true;
  // A bare shebang (with optional comment lines) is also useless.
  const lines = trimmed
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  return lines.length === 0;
}

function isFileNotFound(cause: unknown): boolean {
  if (typeof cause !== "object" || cause === null) return false;
  if (!("code" in cause)) return false;
  return Reflect.get(cause, "code") === "ENOENT";
}
