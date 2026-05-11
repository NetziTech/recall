/**
 * Type guard helper extracted out of
 * `pre-commit-hook-uninstaller.port.ts` so the port file stays
 * pure-interface (type-only, erased by `tsc`).
 *
 * See `pre-commit-hook-installer-status.guard.ts` for the full
 * rationale (vitest#10164 coverage bug + D-021 port purity).
 */

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
