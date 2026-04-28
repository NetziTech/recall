import type { DomainEvent } from "../../../../shared/domain/types/domain-event.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { TaskId } from "../value-objects/task-id.ts";

/**
 * Fact: a `Task` was deleted from the workspace.
 *
 * Emitted exactly once per task by `Task.delete(...)` immediately
 * before the row is dropped from the persistence tier. Subscribers
 * (the curator's auto-clean rules, audit pipeline, etc.) see the
 * deletion as a normal event in the bus and may react accordingly.
 *
 * Why a separate event (instead of reusing `TaskCompleted`):
 * - Completion is a lifecycle state (the task ends in `done` and the
 *   audit trail keeps the `completed_at` timestamp). Deletion drops
 *   the row entirely; downstream consumers need a different signal.
 * - The `mem.task.delete` action (`docs/02-protocolo-mcp.md` §4.5)
 *   is administrative — used to scrub stale or accidental tasks
 *   without polluting the lifecycle state machine.
 *
 * Invariants:
 * - `eventName` is the stable `"memory.task-deleted"` identifier.
 * - The event references the `taskId` AFTER the aggregate has
 *   transitioned its in-memory state but BEFORE the row is removed,
 *   so the persistence adapter can correlate the event with the row
 *   it is about to delete.
 */
export class TaskDeleted implements DomainEvent {
  public readonly eventName = "memory.task-deleted" as const;
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
