import type { TaskId } from "../value-objects/task-id.ts";
import type { TaskStatus } from "../value-objects/task-status.ts";
import { MemoryDomainError } from "./memory-domain-error.ts";

/**
 * Raised when a `Task` mutation would move the aggregate through a
 * status transition the domain refuses to perform.
 *
 * The full transition matrix lives in `Task.ALLOWED_TRANSITIONS`. The
 * legal moves are:
 *
 *   todo         -> in_progress | blocked
 *   in_progress  -> done | blocked
 *   blocked      -> in_progress | todo
 *   done         -> (terminal — no transitions out)
 *
 * Justification:
 * - `done` is terminal: completed work is preserved as audit trail; if
 *   the user wants to "reopen" a done task, they create a new one
 *   referring to it via tags / notes.
 * - `todo -> done` is forbidden: every completion goes through
 *   `in_progress` so the `completed_at_ms` and `started_at_ms`
 *   bookkeeping (when added) is consistent.
 * - `blocked -> done` is forbidden for the same reason: a blocker must
 *   be lifted (-> in_progress) before completion.
 *
 * Invariants:
 * - `code` is the stable identifier `memory.invalid-task-transition`.
 * - `taskId`, `from`, `to` describe the rejected mutation.
 * - `jsonRpcCode` is `null`.
 */
export class InvalidTaskTransitionError extends MemoryDomainError {
  public readonly code = "memory.invalid-task-transition";
  public readonly jsonRpcCode: number | null = null;
  public readonly taskId: TaskId;
  public readonly from: TaskStatus;
  public readonly to: TaskStatus;

  public constructor(
    taskId: TaskId,
    from: TaskStatus,
    to: TaskStatus,
    options?: { cause?: unknown },
  ) {
    super(
      `task ${taskId.toString()} cannot transition from "${from.toString()}" to "${to.toString()}"`,
      options !== undefined ? { cause: options.cause } : undefined,
    );
    this.taskId = taskId;
    this.from = from;
    this.to = to;
  }
}
