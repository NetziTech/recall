import type { DomainEvent } from "../../../../shared/domain/types/domain-event.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { TaskId } from "../value-objects/task-id.ts";

/**
 * Fact: a `Task` was just created.
 *
 * Emitted exactly once per `Task`, by `Task.create(...)`.
 *
 * Invariants:
 * - `eventName` is the stable `"memory.task-created"` identifier.
 */
export class TaskCreated implements DomainEvent {
  public readonly eventName = "memory.task-created" as const;
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
