import type { WorkspaceConfig } from "../../../domain/value-objects/workspace-config.ts";
import type { WorkspacePath } from "../../../domain/value-objects/workspace-path.ts";

/**
 * Driven (output) port for persisting the workspace's identity slice
 * into the `workspace_config` SQL table that the retrieval module's
 * `SqliteMemoryProjectionRepository.loadWorkspaceAnchor` reads when
 * assembling the `workspace_anchor` layer of `mem.context`.
 *
 * Why a dedicated port (rather than a direct call from the use case
 * to `node-better-sqlite3-multiple-ciphers`):
 *   - Hexagonal: the use case must remain testable without touching
 *     SQLite. A `RecordingWorkspaceProjectionWriter` test double can
 *     capture every upsert and replay reads from a map.
 *   - Cross-module decoupling: the `workspace_config` SQL table is
 *     READ by the retrieval/memory/curator modules but only WRITTEN
 *     by workspace. Routing the write through this port keeps the
 *     ownership contract explicit: workspace is the source of truth,
 *     readers consume a snapshot. The schema is shared (declared in
 *     `migrations/006__workspace-config-table.sql`); the code is not.
 *     This mirrors the pattern already used by `embedding_queue` in
 *     migration 002: shared SQL schema, no cross-module imports
 *     (per ADR-001 in `docs/12 §1.5.1`).
 *
 * Atomicity guarantees:
 *   - `upsert` is a single SQL statement (`INSERT ... ON CONFLICT
 *     ... DO UPDATE`) wrapped in an implicit transaction. Either the
 *     row lands as a whole, or it does not. Partial state is
 *     impossible.
 *
 * Lifecycle:
 *   - Called by `InitializeWorkspaceUseCase` when a fresh workspace
 *     is provisioned (after `databaseBootstrap.bootstrap()` has
 *     applied the migrations, before the use case returns).
 *   - Called by `ChangeModeUseCase` when the operator transitions
 *     between privacy modes — the new mode must be reflected for the
 *     next `mem.context` invocation.
 *   - Called by `DestroyWorkspaceUseCase` (indirectly: the row is
 *     dropped together with the entire `.mcp-memoria/` directory; no
 *     dedicated `delete` is needed in this port).
 */
export interface UpsertWorkspaceConfigInput {
  /**
   * Absolute path to the host project root. The adapter resolves
   * `<root>/.mcp-memoria/memoria.db` and opens (or reopens) the
   * SQLite handle to perform the upsert.
   */
  readonly rootPath: WorkspacePath;
  /** Domain config to persist (workspace_id / display_name / mode / created_at). */
  readonly config: WorkspaceConfig;
  /** Epoch milliseconds at which the upsert is happening. */
  readonly updatedAtMs: number;
}

export interface WorkspaceProjectionWriter {
  /**
   * Idempotently writes the workspace's identity slice into the
   * `workspace_config` table. Implementations MUST `INSERT ... ON
   * CONFLICT(workspace_id) DO UPDATE` so a re-init or mode change
   * collapses onto the existing row instead of failing on the PK
   * constraint.
   *
   * Throws a `WorkspaceInfrastructureError` (or equivalent typed
   * failure) when the database is unreachable / locked / encrypted
   * with the wrong key. The use case treats those as
   * non-recoverable.
   */
  upsert(input: UpsertWorkspaceConfigInput): Promise<void>;
}
