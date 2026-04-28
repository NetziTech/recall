import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { CuratorRun } from "../aggregates/curator-run.ts";
import type { CuratorRunId } from "../value-objects/curator-run-id.ts";

/**
 * Driven port for persisting and reloading the `CuratorRun`
 * aggregate.
 *
 * Mirrors the `curator_runs` table contract from
 * `docs/03-modelo-datos.md` §4.11 and the orchestration in
 * `docs/05-memoria-decay.md` §6 (the curator writes a row when it
 * starts and updates it when it finishes).
 *
 * Contract:
 * - `findById` returns `null` when the run does not exist.
 * - `save` is atomic and idempotent (same id, same payload =>
 *   single row in the end).
 * - Domain events buffered on the aggregate are NOT consumed here.
 *   The application layer drains them via `pullEvents()` after
 *   `save` succeeds.
 *
 * Query methods:
 * - `findRecentByWorkspace(workspaceId, limit)` returns the most
 *   recent runs (descending by `startedAt`), bounded by `limit`.
 *   Used by `mcp-memoria curator-log --workspace . [--last 5]`
 *   (`docs/05-memoria-decay.md` §9).
 * - `findLastByWorkspace(workspaceId)` returns the single most
 *   recent run, or `null` if the workspace has never run the
 *   curator. Convenience over `findRecentByWorkspace(..., 1)`
 *   that lets the application layer skip the "first or null"
 *   dance.
 */
export interface CuratorRunRepository {
  findById(id: CuratorRunId): Promise<CuratorRun | null>;

  save(run: CuratorRun): Promise<void>;

  findRecentByWorkspace(
    workspaceId: WorkspaceId,
    limit: number,
  ): Promise<readonly CuratorRun[]>;

  findLastByWorkspace(workspaceId: WorkspaceId): Promise<CuratorRun | null>;
}
