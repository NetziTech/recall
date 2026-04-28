import type { Tags } from "../../../../../shared/domain/value-objects/tags.ts";
import type { WorkspaceId } from "../../../../../shared/domain/value-objects/workspace-id.ts";
import type { Task } from "../../../domain/aggregates/task.ts";
import type { SessionId } from "../../../domain/value-objects/session-id.ts";
import type { TaskId } from "../../../domain/value-objects/task-id.ts";
import type { TaskPriority } from "../../../domain/value-objects/task-priority.ts";
import type { TaskStatus } from "../../../domain/value-objects/task-status.ts";

/**
 * Result of a `TrackTask.create(...)` invocation.
 */
export interface CreateTaskResult {
  readonly taskId: TaskId;
}

/**
 * Result of a status-changing task operation.
 */
export interface UpdateTaskStatusResult {
  readonly taskId: TaskId;
  readonly previousStatus: TaskStatus;
  readonly currentStatus: TaskStatus;
}

/**
 * Result of `TrackTask.delete(...)`. The boolean is always `true` for
 * a successful call (the use case throws `taskNotFound` when no row
 * existed), but it is named explicitly so the wire facade can surface
 * the spec's `{ deleted: boolean }` envelope without introspecting
 * the absence of an exception.
 */
export interface DeleteTaskResult {
  readonly taskId: TaskId;
  readonly deleted: true;
}

/**
 * Driving (input) port: orchestrate `mem.task` actions
 * (`docs/02-protocolo-mcp.md` §4.5).
 *
 * The seven sub-actions match the lifecycle transitions modelled by
 * the `Task` aggregate (`docs/03-modelo-datos.md` §4.7) plus the two
 * read/admin endpoints exposed by the wire contract:
 *
 * - `create(...)`            — TaskCreated, status=`todo`.
 * - `start(...)`             — TaskStarted, status -> `in_progress`.
 * - `block(...)`             — TaskBlocked, status -> `blocked`.
 * - `unblock(...)`           — TaskUnblocked, status -> `todo`.
 * - `complete(...)`          — TaskCompleted, status -> `done`.
 * - `list(...)`              — read-only query, no event.
 * - `get(...)`               — read-only fetch by id, no event.
 * - `delete(...)`            — TaskDeleted; hard delete, no status
 *                              transition.
 *
 * Why the unified port (instead of one per action):
 * - SOLID-ISP would split it; SOLID-SRP keeps it together because
 *   every method shares the same dependency graph (`TaskRepository`,
 *   `IdGenerator`, `Clock`, `EventPublisher`). A consumer that only
 *   needs the `list` slice can name `TrackTask["list"]`. Splitting
 *   would force composition to wire five constructors with the same
 *   dependencies.
 *
 * Auto-rotate behaviour:
 * - Like `RecordTurn`, `create(...)` checks the active session via
 *   the implicit-session helper so the new task is linked to the
 *   right session id. The other transitions do NOT touch the
 *   session — task lifecycle is independent of conversation
 *   sessions.
 */
export interface TrackTask {
  /**
   * Creates a brand-new task in the workspace with status `todo`.
   * The `description`, `dueAtMs`, and `tags` are optional. When
   * `sessionId` is omitted the use case attaches the task to the
   * current implicit session (if any).
   */
  create(input: {
    workspaceId: WorkspaceId;
    title: string;
    description: string | null;
    priority: TaskPriority;
    tags: Tags;
    dueAtMs: number | null;
  }): Promise<CreateTaskResult>;

  /**
   * Moves the task into `in_progress`. Throws
   * `MemoryApplicationError.taskNotFound` when the id does not exist.
   * Domain refuses illegal transitions via
   * `InvalidTaskTransitionError`.
   */
  start(input: {
    workspaceId: WorkspaceId;
    taskId: TaskId;
  }): Promise<UpdateTaskStatusResult>;

  /**
   * Moves the task into `blocked`.
   */
  block(input: {
    workspaceId: WorkspaceId;
    taskId: TaskId;
  }): Promise<UpdateTaskStatusResult>;

  /**
   * Moves the task back from `blocked` to `todo`.
   */
  unblock(input: {
    workspaceId: WorkspaceId;
    taskId: TaskId;
  }): Promise<UpdateTaskStatusResult>;

  /**
   * Moves the task into `done` and pins `completedAt`.
   */
  complete(input: {
    workspaceId: WorkspaceId;
    taskId: TaskId;
  }): Promise<UpdateTaskStatusResult>;

  /**
   * Lists tasks. When `status` is provided the result is filtered;
   * when omitted the use case returns OPEN tasks (the default `mem.task
   * list` behaviour per `docs/02-protocolo-mcp.md` §4.5).
   */
  list(input: {
    workspaceId: WorkspaceId;
    status: TaskStatus | null;
  }): Promise<readonly Task[]>;

  /**
   * Returns the task identified by `taskId`. Throws
   * `MemoryApplicationError.taskNotFound` when the id does not exist
   * in this workspace. Backs the `mem.task.get` wire action
   * (`docs/02-protocolo-mcp.md` §4.5).
   *
   * Read-only: emits no event and does not bump `updatedAt`.
   */
  get(input: {
    workspaceId: WorkspaceId;
    taskId: TaskId;
  }): Promise<Task>;

  /**
   * Hard-deletes the task identified by `taskId` and publishes
   * `TaskDeleted`. Throws `MemoryApplicationError.taskNotFound` when
   * the id does not exist (so the caller can surface a typed failure
   * instead of a silent no-op).
   *
   * Backs the `mem.task.delete` wire action
   * (`docs/02-protocolo-mcp.md` §4.5).
   */
  delete(input: {
    workspaceId: WorkspaceId;
    taskId: TaskId;
  }): Promise<DeleteTaskResult>;

  /**
   * Returns the active session id at the time of the call (or `null`
   * when no session exists). Exposed so the upstream MCP/CLI handler
   * can include it in the `mem.task` response.
   */
  currentSessionId(workspaceId: WorkspaceId): Promise<SessionId | null>;
}
