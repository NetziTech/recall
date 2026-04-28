import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { Workspace } from "../aggregates/workspace.ts";

/**
 * Driven port (output port) for persisting and reloading the
 * `Workspace` aggregate.
 *
 * Implementations live in `infrastructure/persistence/` and translate
 * between the in-memory aggregate and the on-disk representation
 * documented in `docs/03-modelo-datos.md` §1-§2 (`config.json` plus
 * the eventual SQLite databases that share the same `workspace_id`).
 *
 * Contract:
 * - The repository works with the **whole aggregate**. Adapters MUST
 *   NOT expose partial-update methods or expose internal fields. If a
 *   use case wants to mutate the workspace, it loads the aggregate,
 *   calls a domain method, then `save`s it back.
 * - `findById` returns `null` (not a thrown error) when the workspace
 *   does not exist on disk. Callers decide whether absence is a
 *   recoverable condition (typical case: the user is about to call
 *   `mem.init`) or a hard failure.
 * - `save` is responsible for writing the persistent slice of the
 *   aggregate (`config.json`) atomically. The runtime-only `unlocked`
 *   flag is NOT persisted (it lives in the process for the duration of
 *   the session; see `docs/11-seguridad-modos.md` §3 — keys live in
 *   `~/.config/.../keys/` and are loaded into the unlock state on
 *   startup, not stored in the workspace itself).
 * - Events buffered in the aggregate are NOT consumed by the
 *   repository. The application layer drains them via
 *   `pullEvents()` after `save` succeeds and dispatches them to the
 *   subscribers.
 */
export interface WorkspaceRepository {
  /**
   * Loads the workspace identified by `id` from persistence. Returns
   * `null` if it does not exist.
   */
  findById(id: WorkspaceId): Promise<Workspace | null>;

  /**
   * Persists the workspace. Implementations are free to perform an
   * upsert (the aggregate carries its own identity) but MUST be
   * atomic: a partial write that leaves `config.json` corrupted is a
   * contract violation.
   */
  save(workspace: Workspace): Promise<void>;
}
