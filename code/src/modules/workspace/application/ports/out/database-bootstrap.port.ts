import type { WorkspacePath } from "../../../domain/value-objects/workspace-path.ts";
import type { WorkspaceMode } from "../../../domain/value-objects/workspace-mode.ts";

/**
 * Driven (output) port responsible for opening the SQLite database
 * sitting under `<root>/.mcp-memoria/memoria.db` and applying the
 * bundled migrations.
 *
 * Why this is a port and not a direct call to `SqliteDatabase.open`
 * + `MigrationsRunner.run`:
 *   - The composition root owns the wiring: the workspace use case
 *     does not know which migration directory to point the runner
 *     at, nor which encryption key to inject when the mode is
 *     `encrypted`. Hiding both concerns behind an adapter keeps the
 *     use case independent of the boot path.
 *   - The port also represents a clean teardown boundary: the
 *     adapter is the one that knows how to close the connection
 *     after the bootstrap is done (or hand it to the rest of the
 *     server, depending on the composition path).
 *
 * Health-check use case:
 *   The same port is reused by `HealthCheckUseCase` to assert "the
 *   database is openable". The `probe` flavour skips the migration
 *   step (read-only handle, no DDL) so a healthy production database
 *   is not perturbed by a probe.
 */
export interface DatabaseBootstrapInput {
  readonly rootPath: WorkspacePath;
  readonly mode: WorkspaceMode;
}

export interface DatabaseBootstrapResult {
  /**
   * Highest migration version present in the database after the
   * bootstrap completes. `0` means the database was empty AND no
   * bundled migrations exist (only possible in tests).
   */
  readonly schemaVersion: number;
}

export interface DatabaseProbeResult {
  /** `true` iff a SQLite connection could be opened (read-only). */
  readonly openable: boolean;
  /** `null` when the connection failed; otherwise the on-disk version. */
  readonly schemaVersion: number | null;
}

export interface DatabaseBootstrap {
  /**
   * Opens the workspace database, runs all bundled migrations in
   * order, and closes the handle.
   */
  bootstrap(input: DatabaseBootstrapInput): Promise<DatabaseBootstrapResult>;

  /**
   * Read-only probe: opens the database, reads the schema_version,
   * and closes immediately. Never mutates state.
   */
  probe(input: DatabaseBootstrapInput): Promise<DatabaseProbeResult>;
}
