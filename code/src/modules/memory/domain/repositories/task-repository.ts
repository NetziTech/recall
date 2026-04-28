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
 */
export interface TaskRepository {
  findById(id: TaskId): Promise<Task | null>;

  save(task: Task): Promise<void>;

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
