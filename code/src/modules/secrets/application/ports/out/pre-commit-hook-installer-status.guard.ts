/**
 * Type guard helper extracted out of `pre-commit-hook-installer.port.ts`
 * so the port file stays pure-interface (type-only, erased by `tsc`).
 *
 * Why it lives in a separate file: vitest 4 has a known coverage bug
 * (vitest#10164) where any `!`-prefixed pattern inside
 * `coverage.exclude` poisons inclusion logic and produces empty
 * `lcov.info`. We previously relied on negated patterns to override
 * the blanket port-files exclude (so the type-guards stayed
 * measurable). Moving the runtime helper here removes the need for
 * the negation while keeping coverage 100% on the executable code.
 *
 * Architectural note: port files (D-021 convention, `.port.ts`)
 * stay type-only. Runtime helpers that narrow port-related unions
 * live alongside the port in sibling `-status.guard.ts` files.
 */

/**
 * Set of legal `PreCommitHookInstallStatus` values describing the
 * outcome of an `install(...)` call.
 *
 * - `installed`: the hook file was created.
 * - `already-managed`: a hook file managed by this codebase already
 *   existed (idempotent re-install). Detected via a managed-by
 *   marker the adapter writes into the hook content.
 * - `replaced-foreign`: a foreign hook file existed and was
 *   replaced. Surfaced separately so the caller can decide whether
 *   to surface a warning.
 */
const PRE_COMMIT_HOOK_INSTALL_STATUSES = [
  "installed",
  "already-managed",
  "replaced-foreign",
] as const;

export type PreCommitHookInstallStatus =
  (typeof PRE_COMMIT_HOOK_INSTALL_STATUSES)[number];

/**
 * Type guard helper exported as a free function so consumers can
 * narrow status strings without instantiating an installer adapter.
 *
 * Lives next to the union to keep the source of truth compact.
 */
export function isPreCommitHookInstallStatus(
  candidate: string,
): candidate is PreCommitHookInstallStatus {
  for (const known of PRE_COMMIT_HOOK_INSTALL_STATUSES) {
    if (known === candidate) return true;
  }
  return false;
}
