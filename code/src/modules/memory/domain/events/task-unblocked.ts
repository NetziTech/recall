import type { DomainEvent } from "../../../../shared/domain/types/domain-event.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { TaskId } from "../value-objects/task-id.ts";

/**
 * Fact: a `Task` was moved out of the `blocked` state back to `todo`.
 *
 * Emitted by `Task.unblock(...)`. Note that going from `blocked`
 * directly to `in_progress` is also legal and emits `TaskStarted`
 * instead — `TaskUnblocked` only fires when the unblock returns the
 * task to the `todo` queue.
 *
 * Invariants:
 * - `eventName` is the stable `"memory.task-unblocked"` identifier.
 */
export class TaskUnblocked implements DomainEvent {
  public readonly eventName = "memory.task-unblocked" as const;
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
