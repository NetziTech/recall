import type { WorkspacePath } from "../../../domain/value-objects/workspace-path.ts";

/**
 * Driving (input) port for `mcp-memoria health --workspace <path>`
 * (`docs/07-instalacion.md` §7 — "Stats / health") and the `mem.health`
 * MCP tool (`docs/02-protocolo-mcp.md`).
 *
 * Performs a set of cheap integrity checks and returns a structured
 * report the CLI / MCP layer can render:
 *   - `workspaceExists`: a `.mcp-memoria/config.json` was found upward
 *     from `rootPath` and parsed successfully.
 *   - `databaseOpenable`: the SQLite database opened (with the cached
 *     key for encrypted mode).
 *   - `migrationsCurrent`: the migration runner reports the on-disk
 *     schema_version is at parity with the bundled migrations.
 *   - `embedderLoadable`: the configured embedder reports a non-zero
 *     dimension when initialised (lazy probe).
 *   - `gitignoreConsistent`: for `private` mode, the `.gitignore`
 *     contains the expected `.mcp-memoria/` exclusion; for shared /
 *     encrypted modes, the entry is absent.
 *
 * Each entry is a tri-state: `pass | fail | skipped`. Skipped means
 * the check did not apply to the current mode (e.g. encryption checks
 * on a `shared` workspace). Failure is non-fatal: the use case
 * collects every failure and returns the full report. The CLI maps
 * any non-pass to a non-zero exit code.
 */
export type HealthCheckStatus = "pass" | "fail" | "skipped";

export interface HealthCheckEntry {
  readonly id: string;
  readonly status: HealthCheckStatus;
  readonly message: string;
}

export interface HealthCheckInput {
  readonly rootPath: WorkspacePath;
}

export interface HealthCheckOutput {
  readonly checks: readonly HealthCheckEntry[];
  /** `true` iff every check is `pass` or `skipped`. */
  readonly healthy: boolean;
}

export interface HealthCheck {
  check(input: HealthCheckInput): Promise<HealthCheckOutput>;
}
