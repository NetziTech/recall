import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { Task } from "../aggregates/task.ts";
import type { TaskId } from "../value-objects/task-id.ts";
import type { TaskPriority } from "../value-objects/task-priority.ts";
import type { TaskStatus } from "../value-objects/task-status.ts";

/**
 * Driven port for persisting and reloading the `Task` aggregate.
 *
 * Mirrors the `tasks` table contract from `docs/03-modelo-datos.md`
 * §4.7 and the `mem.task` API surface in
 * `docs/02-protocolo-mcp.md` §4.5. Tasks have the richest query
 * surface (status + priority filters, "open" predicate) so the
 * interface intentionally exposes business-named methods rather than
 * a generic `findBy(predicate)`.
 *
 * Contract:
 * - `findById` returns `null` on miss.
 * - `save` is atomic.
 * - `delete` is idempotent: it returns `true` when a row was
 *   actually removed and `false` when no such row existed (so the
 *   use case can translate the `false` return into a typed
 *   `taskNotFound` failure for the caller).
 */
export interface TaskRepository {
  findById(id: TaskId): Promise<Task | null>;

  save(task: Task): Promise<void>;

  /**
   * Hard-deletes the task row identified by `id`. Returns `true` when
   * a row was removed, `false` when no row existed.
   *
   * Why a hard delete (and not a soft `deleted_at` flag):
   * - The `tasks` schema (`docs/03-modelo-datos.md` §4.7) does not
   *   include a tombstone column; adding one is a schema migration
   *   out of scope for the `mem.task.delete` action.
   * - The wire contract (`docs/02-protocolo-mcp.md` §4.5) returns
   *   `{ deleted: boolean }` — a hard delete satisfies the contract
   *   without leaking storage details.
   * - Tasks are not embedded (no row in `embedding_queue` or vector
   *   tables targets a `task` kind), so no downstream cleanup is
   *   needed beyond the `tasks` row itself.
   */
  delete(id: TaskId): Promise<boolean>;

  /**
   * Returns every task in `workspaceId` whose status is non-terminal
   * (`status !== "done"`). Powers Capa 3 of the context bundle
   * (`docs/04-capas-contexto.md` §3.3 — Active Tasks).
   */
  findOpenByWorkspace(workspaceId: WorkspaceId): Promise<readonly Task[]>;

  /**
   * Returns every task in `workspaceId` matching the supplied status.
   * Powers `mem.task.list({ filter: { status } })`.
   */
  findByStatus(
    workspaceId: WorkspaceId,
    status: TaskStatus,
  ): Promise<readonly Task[]>;

  /**
   * Returns every task in `workspaceId` matching the supplied
   * priority. Used by sort-by-priority queries that the recall layer
   * issues when the user is ranking work.
   */
  findByPriority(
    workspaceId: WorkspaceId,
    priority: TaskPriority,
  ): Promise<readonly Task[]>;
}
