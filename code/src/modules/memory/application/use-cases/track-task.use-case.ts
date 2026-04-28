import type { Clock } from "../../../../shared/application/ports/clock.port.ts";
import type { EventPublisher } from "../../../../shared/application/ports/event-publisher.port.ts";
import type { IdGenerator } from "../../../../shared/application/ports/id-generator.port.ts";
import type { Tags } from "../../../../shared/domain/value-objects/tags.ts";
import { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import { Task } from "../../domain/aggregates/task.ts";
import type { TaskRepository } from "../../domain/repositories/task-repository.ts";
import type { SessionId } from "../../domain/value-objects/session-id.ts";
import { TaskDescription } from "../../domain/value-objects/task-description.ts";
import { TaskId } from "../../domain/value-objects/task-id.ts";
import type { TaskPriority } from "../../domain/value-objects/task-priority.ts";
import type { TaskStatus } from "../../domain/value-objects/task-status.ts";
import { TaskTitle } from "../../domain/value-objects/task-title.ts";
import { MemoryApplicationError } from "../errors/memory-application-error.ts";
import type {
  CreateTaskResult,
  DeleteTaskResult,
  TrackTask,
  UpdateTaskStatusResult,
} from "../ports/in/track-task.port.ts";
import type { SessionContextHelper } from "./session-context-helper.ts";

/**
 * Use case: orchestrate the `mem.task` action set.
 *
 * Implements the `TrackTask` driving port. Each public method maps
 * 1:1 to a sub-action in `docs/02-protocolo-mcp.md` §4.5:
 *
 * - `create`   → mints id, builds aggregate, persists, publishes
 *                `TaskCreated`. Hooks into the active session via
 *                {@link SessionContextHelper.findActive} so
 *                `Task.create({ sessionId })` reflects the current
 *                session id (or `null`).
 * - `start`    → loads, mutates (`task.start(...)`), persists,
 *                publishes `TaskStarted`. Throws
 *                `MemoryApplicationError.taskNotFound` when the id is
 *                unknown; the aggregate throws
 *                `InvalidTaskTransitionError` on illegal moves.
 * - `block`    → `task.block(...)`, `TaskBlocked`.
 * - `unblock`  → `task.unblock(...)`, `TaskUnblocked`.
 * - `complete` → `task.complete(...)`, `TaskCompleted`. Pins
 *                `completedAt`.
 * - `list`     → `TaskRepository.findOpenByWorkspace(...)` when
 *                `status === null`, else `findByStatus(...)`.
 *
 * Why a single class:
 * - Dependency overlap: every method needs `TaskRepository` + `Clock`
 *   + `EventPublisher`. Splitting one class per method would force
 *   composition to wire identical dependencies five times.
 */
export class TrackTaskUseCase implements TrackTask {
  public constructor(
    private readonly tasks: TaskRepository,
    private readonly sessionHelper: SessionContextHelper,
    private readonly idGen: IdGenerator,
    private readonly clock: Clock,
    private readonly events: EventPublisher,
  ) {}

  public async create(input: {
    workspaceId: WorkspaceId;
    title: string;
    description: string | null;
    priority: TaskPriority;
    tags: Tags;
    dueAtMs: number | null;
  }): Promise<CreateTaskResult> {
    const now = this.clock.now();
    const session = await this.sessionHelper.findActive(input.workspaceId);
    const sessionId: SessionId | null =
      session === null ? null : session.getId();
    const taskId = TaskId.from(this.idGen.generateString());
    const task = Task.create({
      id: taskId,
      workspaceId: input.workspaceId,
      sessionId,
      title: TaskTitle.from(input.title),
      description:
        input.description === null ||
        input.description.trim().length === 0
          ? null
          : TaskDescription.from(input.description),
      priority: input.priority,
      tags: input.tags,
      dueAt:
        input.dueAtMs === null ? null : Timestamp.fromEpochMs(input.dueAtMs),
      occurredAt: now,
    });
    await this.tasks.save(task);
    await this.events.publishAll(task.pullEvents());
    return { taskId };
  }

  public async start(input: {
    workspaceId: WorkspaceId;
    taskId: TaskId;
  }): Promise<UpdateTaskStatusResult> {
    return this.transition(input.workspaceId, input.taskId, (task) => {
      task.start({ occurredAt: this.clock.now() });
    });
  }

  public async block(input: {
    workspaceId: WorkspaceId;
    taskId: TaskId;
  }): Promise<UpdateTaskStatusResult> {
    return this.transition(input.workspaceId, input.taskId, (task) => {
      task.block({ occurredAt: this.clock.now() });
    });
  }

  public async unblock(input: {
    workspaceId: WorkspaceId;
    taskId: TaskId;
  }): Promise<UpdateTaskStatusResult> {
    return this.transition(input.workspaceId, input.taskId, (task) => {
      task.unblock({ occurredAt: this.clock.now() });
    });
  }

  public async complete(input: {
    workspaceId: WorkspaceId;
    taskId: TaskId;
  }): Promise<UpdateTaskStatusResult> {
    return this.transition(input.workspaceId, input.taskId, (task) => {
      task.complete({ occurredAt: this.clock.now() });
    });
  }

  public async list(input: {
    workspaceId: WorkspaceId;
    status: TaskStatus | null;
  }): Promise<readonly Task[]> {
    if (input.status === null) {
      return this.tasks.findOpenByWorkspace(input.workspaceId);
    }
    return this.tasks.findByStatus(input.workspaceId, input.status);
  }

  public async get(input: {
    workspaceId: WorkspaceId;
    taskId: TaskId;
  }): Promise<Task> {
    // The `workspaceId` is unused at this layer — the repository is
    // already pinned to a single workspace via composition (see
    // `composition/wiring/memory-wiring.ts`). The parameter stays in
    // the port signature so cross-workspace defenses can be enforced
    // here in the future without a breaking change to callers.
    void input.workspaceId;
    const task = await this.tasks.findById(input.taskId);
    if (task === null) {
      throw MemoryApplicationError.taskNotFound(input.taskId.toString());
    }
    return task;
  }

  public async delete(input: {
    workspaceId: WorkspaceId;
    taskId: TaskId;
  }): Promise<DeleteTaskResult> {
    void input.workspaceId;
    // Load first so we can emit the domain event with full context
    // (workspace id, occurredAt, etc.) BEFORE the row is gone. The
    // repository's `delete(...)` returns `false` for a missing row,
    // but `findById` already covers the "id does not exist" branch
    // with a typed `taskNotFound` failure.
    const task = await this.tasks.findById(input.taskId);
    if (task === null) {
      throw MemoryApplicationError.taskNotFound(input.taskId.toString());
    }
    const occurredAt = this.clock.now();
    task.delete({ occurredAt });
    const rowDeleted = await this.tasks.delete(input.taskId);
    if (!rowDeleted) {
      // Race: the row was removed between `findById` and `delete`.
      // Surface the same typed failure so the caller never sees a
      // silent no-op.
      throw MemoryApplicationError.taskNotFound(input.taskId.toString());
    }
    await this.events.publishAll(task.pullEvents());
    return { taskId: input.taskId, deleted: true };
  }

  public async currentSessionId(
    workspaceId: WorkspaceId,
  ): Promise<SessionId | null> {
    const session = await this.sessionHelper.findActive(workspaceId);
    if (session === null) return null;
    return session.getId();
  }

  // -- internals --------------------------------------------------------

  /**
   * Loads the task, applies `mutator`, saves, and publishes events.
   * Returns the `(previousStatus, currentStatus)` pair the caller
   * surfaces as part of the response.
   */
  private async transition(
    workspaceId: WorkspaceId,
    taskId: TaskId,
    mutator: (task: Task) => void,
  ): Promise<UpdateTaskStatusResult> {
    void workspaceId;
    const task = await this.tasks.findById(taskId);
    if (task === null) {
      throw MemoryApplicationError.taskNotFound(taskId.toString());
    }
    const previousStatus = task.getStatus();
    mutator(task);
    await this.tasks.save(task);
    await this.events.publishAll(task.pullEvents());
    return {
      taskId,
      previousStatus,
      currentStatus: task.getStatus(),
    };
  }
}
