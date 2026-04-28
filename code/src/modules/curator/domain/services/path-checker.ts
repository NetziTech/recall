import type { PathStaleness } from "../value-objects/path-staleness.ts";

/**
 * Driven port (output port) for the curator's path-staleness check.
 *
 * Used by the Caso 1 self-healing pass documented in
 * `docs/05-memoria-decay.md` §5: every `Entity.location` is probed
 * against the workspace's filesystem; missing or unresolvable paths
 * become `HealthFinding`s of kind `path_stale`.
 *
 * Contract:
 * - `checkPaths(paths)` accepts a list of path strings (typically
 *   pulled from `Entity.location` after parsing the optional
 *   `:line` suffix) and returns a `PathStaleness` for each input,
 *   in the same order. The order-preserving contract lets the
 *   caller pair each result back to its originating entry without a
 *   lookup table.
 * - The implementation is responsible for resolving relative paths
 *   against the workspace root (per the algorithm in
 *   `docs/05-memoria-decay.md` §5 Caso 1 — "absolute or `~`
 *   expanded; otherwise `path.join(workspace.path, path)`"). The
 *   curator domain does not expose the workspace path because it
 *   would force a cross-module import to `Workspace`; instead the
 *   adapter is constructed in the composition root with the
 *   workspace path baked in.
 * - The method is `Promise`-typed because the underlying probe is
 *   `fs.stat` (asynchronous in Node).
 * - Implementations MUST NOT throw on individual path failures —
 *   they map the failure to a `PathStaleness` of kind `missing` or
 *   `unresolvable`. They MAY throw on infrastructure-level errors
 *   (filesystem permission denied for the entire scan, ...) which
 *   the application layer catches and records as a curator-level
 *   error.
 */
export interface PathChecker {
  checkPaths(paths: readonly string[]): Promise<readonly PathStaleness[]>;
}
