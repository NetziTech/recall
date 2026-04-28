import type { DomainEvent } from "../../../../shared/domain/types/domain-event.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { TaskId } from "../value-objects/task-id.ts";

/**
 * Fact: a `Task` was completed.
 *
 * Emitted by `Task.complete(...)`. Once emitted, the task aggregate is
 * effectively read-only (no further transitions are legal — see
 * `InvalidTaskTransitionError`).
 *
 * Invariants:
 * - `eventName` is the stable `"memory.task-completed"` identifier.
 */
export class TaskCompleted implements DomainEvent {
  public readonly eventName = "memory.task-completed" as const;
  public readonly occurredAt: Timestamp;
  public readonly workspaceId: WorkspaceId;
  public readonly taskId: TaskId;

  public constructor(input: {
    workspaceId: WorkspaceId;
    taskId: TaskId;
    occurredAt: Timestamp;
  }) {
    this.workspaceId = input.workspaceId;
    this.taskId = input.taskId;
    this.occurredAt = input.occurredAt;
  }
}
