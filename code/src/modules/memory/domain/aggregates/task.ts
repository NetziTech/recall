import type { DomainEvent } from "../../../../shared/domain/types/domain-event.ts";
import type { Tags } from "../../../../shared/domain/value-objects/tags.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import { InvalidTaskTransitionError } from "../errors/invalid-task-transition-error.ts";
import { TaskBlocked } from "../events/task-blocked.ts";
import { TaskCompleted } from "../events/task-completed.ts";
import { TaskCreated } from "../events/task-created.ts";
import { TaskStarted } from "../events/task-started.ts";
import { TaskUnblocked } from "../events/task-unblocked.ts";
import type { SessionId } from "../value-objects/session-id.ts";
import type { TaskDescription } from "../value-objects/task-description.ts";
import type { TaskId } from "../value-objects/task-id.ts";
import type { TaskPriority } from "../value-objects/task-priority.ts";
import {
  TaskStatus,
  type TaskStatusKind,
} from "../value-objects/task-status.ts";
import type { TaskTitle } from "../value-objects/task-title.ts";

/**
 * Encapsulates the matrix of legal task-status transitions in one
 * place.
 *
 * Legal moves (sources of truth: `docs/03-modelo-datos.md` §4.7 and
 * `docs/02-protocolo-mcp.md` §4.5):
 *
 *   todo         -> in_progress | blocked
 *   in_progress -> done | blocked
 *   blocked     -> in_progress | todo
 *   done        -> (terminal — no transitions out)
 *
 * Justification:
 * - `done` is terminal so the audit trail is preserved. Reopening
 *   would erase `completedAt`.
 * - `todo -> done` and `blocked -> done` are forbidden so that every
 *   completion has an `in_progress` segment, which keeps the
 *   `started_at_ms` / `completed_at_ms` bookkeeping (when added)
 *   consistent.
 *
 * Self-transitions are rejected by the aggregate before the table is
 * consulted: there is no event to emit and no work to do.
 */
const ALLOWED_TASK_TRANSITIONS: Readonly<
  Record<TaskStatusKind, readonly TaskStatusKind[]>
> = Object.freeze({
  todo: Object.freeze<TaskStatusKind[]>(["in_progress", "blocked"]),
  in_progress: Object.freeze<TaskStatusKind[]>(["done", "blocked"]),
  blocked: Object.freeze<TaskStatusKind[]>(["in_progress", "todo"]),
  done: Object.freeze<TaskStatusKind[]>([]),
});

/**
 * Aggregate root for the `Task` kind of memory entry.
 *
 * Mirrors the `tasks` table documented in `docs/03-modelo-datos.md`
 * §4.7. Tasks are the only memory kind with a non-trivial state
 * machine; the aggregate owns the transition matrix and refuses
 * illegal moves with `InvalidTaskTransitionError`.
 *
 * Invariants:
 * - Identity is immutable.
 * - `completedAt !== null` iff `status === "done"`. The aggregate
 *   sets it on `complete(...)` and never clears it (`done` is
 *   terminal — see the rationale next to `ALLOWED_TASK_TRANSITIONS`).
 * - Status changes go through the legal-transitions table; self-
 *   transitions are explicitly rejected.
 */
export class Task {
  private readonly id: TaskId;
  private readonly workspaceId: WorkspaceId;
  /**
   * Session that captured the task, or `null` when the task was
   * created without an active session (e.g. a CLI seed import or a
   * scripted backfill). The `tasks` table in `docs/03-modelo-datos.md`
   * §4.7 does not declare a `session_id` column; the persistence
   * adapter is responsible for projecting this field into
   * `metadata_json` (or for ignoring it). Modelling the optionality in
   * the domain keeps the link available for the curator when the
   * schema catches up.
   */
  private readonly sessionId: SessionId | null;
  private readonly title: TaskTitle;
  private readonly description: TaskDescription | null;
  private status: TaskStatus;
  private readonly priority: TaskPriority;
  private readonly tags: Tags;
  private readonly dueAt: Timestamp | null;
  private readonly createdAt: Timestamp;
  private updatedAt: Timestamp;
  private completedAt: Timestamp | null;
  private readonly events: DomainEvent[];

  private constructor(input: {
    id: TaskId;
    workspaceId: WorkspaceId;
    sessionId: SessionId | null;
    title: TaskTitle;
    description: TaskDescription | null;
    status: TaskStatus;
    priority: TaskPriority;
    tags: Tags;
    dueAt: Timestamp | null;
    createdAt: Timestamp;
    updatedAt: Timestamp;
    completedAt: Timestamp | null;
    events: readonly DomainEvent[];
  }) {
    this.id = input.id;
    this.workspaceId = input.workspaceId;
    this.sessionId = input.sessionId;
    this.title = input.title;
    this.description = input.description;
    this.status = input.status;
    this.priority = input.priority;
    this.tags = input.tags;
    this.dueAt = input.dueAt;
    this.createdAt = input.createdAt;
    this.updatedAt = input.updatedAt;
    this.completedAt = input.completedAt;
    this.events = [...input.events];
  }

  // -- factories -----------------------------------------------------------

  /**
   * Brings a brand-new `Task` into existence with status `todo`.
   * Emits `TaskCreated`.
   */
  public static create(input: {
    id: TaskId;
    workspaceId: WorkspaceId;
    sessionId: SessionId | null;
    title: TaskTitle;
    description: TaskDescription | null;
    priority: TaskPriority;
    tags: Tags;
    dueAt: Timestamp | null;
    occurredAt: Timestamp;
  }): Task {
    const event = new TaskCreated({
      workspaceId: input.workspaceId,
      taskId: input.id,
      occurredAt: input.occurredAt,
    });
    return new Task({
      id: input.id,
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      title: input.title,
      description: input.description,
      status: TaskStatus.todo(),
      priority: input.priority,
      tags: input.tags,
      dueAt: input.dueAt,
      createdAt: input.occurredAt,
      updatedAt: input.occurredAt,
      completedAt: null,
      events: [event],
    });
  }

  /**
   * Rehydrates a `Task` from previously-persisted state. Does NOT
   * emit any event.
   */
  public static rehydrate(input: {
    id: TaskId;
    workspaceId: WorkspaceId;
    sessionId: SessionId | null;
    title: TaskTitle;
    description: TaskDescription | null;
    status: TaskStatus;
    priority: TaskPriority;
    tags: Tags;
    dueAt: Timestamp | null;
    createdAt: Timestamp;
    updatedAt: Timestamp;
    completedAt: Timestamp | null;
  }): Task {
    return new Task({
      id: input.id,
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      title: input.title,
      description: input.description,
      status: input.status,
      priority: input.priority,
      tags: input.tags,
      dueAt: input.dueAt,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
      completedAt: input.completedAt,
      events: [],
    });
  }

  // -- mutations -----------------------------------------------------------

  /**
   * Moves the task into `in_progress`. Legal from `todo` and from
   * `blocked` (the latter case represents the operator unblocking and
   * resuming work in one step).
   *
   * Emits `TaskStarted`.
   */
  public start(input: { occurredAt: Timestamp }): void {
    const target = TaskStatus.inProgress();
    this.assertTransitionLegal(target);
    this.status = target;
    this.updatedAt = input.occurredAt;
    this.events.push(
      new TaskStarted({
        workspaceId: this.workspaceId,
        taskId: this.id,
        occurredAt: input.occurredAt,
      }),
    );
  }

  /**
   * Moves the task into `blocked`. Legal from `todo` and `in_progress`.
   *
   * Emits `TaskBlocked`.
   */
  public block(input: { occurredAt: Timestamp }): void {
    const target = TaskStatus.blocked();
    this.assertTransitionLegal(target);
    this.status = target;
    this.updatedAt = input.occurredAt;
    this.events.push(
      new TaskBlocked({
        workspaceId: this.workspaceId,
        taskId: this.id,
        occurredAt: input.occurredAt,
      }),
    );
  }

  /**
   * Moves the task back from `blocked` to `todo`. Use `start(...)`
   * instead if the operator wants to unblock AND immediately resume
   * work.
   *
   * Emits `TaskUnblocked`.
   */
  public unblock(input: { occurredAt: Timestamp }): void {
    const target = TaskStatus.todo();
    this.assertTransitionLegal(target);
    this.status = target;
    this.updatedAt = input.occurredAt;
    this.events.push(
      new TaskUnblocked({
        workspaceId: this.workspaceId,
        taskId: this.id,
        occurredAt: input.occurredAt,
      }),
    );
  }

  /**
   * Moves the task into `done` and pins `completedAt`. Legal only
   * from `in_progress` (every completion goes through that state, see
   * `ALLOWED_TASK_TRANSITIONS`).
   *
   * Emits `TaskCompleted`.
   */
  public complete(input: { occurredAt: Timestamp }): void {
    const target = TaskStatus.done();
    this.assertTransitionLegal(target);
    this.status = target;
    this.completedAt = input.occurredAt;
    this.updatedAt = input.occurredAt;
    this.events.push(
      new TaskCompleted({
        workspaceId: this.workspaceId,
        taskId: this.id,
        occurredAt: input.occurredAt,
      }),
    );
  }

  // -- queries -------------------------------------------------------------

  public getId(): TaskId {
    return this.id;
  }

  public getWorkspaceId(): WorkspaceId {
    return this.workspaceId;
  }

  public getSessionId(): SessionId | null {
    return this.sessionId;
  }

  public getTitle(): TaskTitle {
    return this.title;
  }

  public getDescription(): TaskDescription | null {
    return this.description;
  }

  public getStatus(): TaskStatus {
    return this.status;
  }

  public getPriority(): TaskPriority {
    return this.priority;
  }

  public getTags(): Tags {
    return this.tags;
  }

  public getDueAt(): Timestamp | null {
    return this.dueAt;
  }

  public getCreatedAt(): Timestamp {
    return this.createdAt;
  }

  public getUpdatedAt(): Timestamp {
    return this.updatedAt;
  }

  public getCompletedAt(): Timestamp | null {
    return this.completedAt;
  }

  public isOpen(): boolean {
    return this.status.isOpen();
  }

  public pullEvents(): readonly DomainEvent[] {
    if (this.events.length === 0) return Object.freeze([]);
    const drained = this.events.slice();
    this.events.length = 0;
    return Object.freeze(drained);
  }

  // -- internals -----------------------------------------------------------

  /**
   * Throws `InvalidTaskTransitionError` if `target` is not reachable
   * from the current status. Self-transitions and out-of-`done` moves
   * are both rejected here.
   */
  private assertTransitionLegal(target: TaskStatus): void {
    if (this.status.equals(target)) {
      throw new InvalidTaskTransitionError(this.id, this.status, target);
    }
    const allowed = ALLOWED_TASK_TRANSITIONS[this.status.kind];
    let isLegal = false;
    for (const kind of allowed) {
      if (kind === target.kind) {
        isLegal = true;
        break;
      }
    }
    if (!isLegal) {
      throw new InvalidTaskTransitionError(this.id, this.status, target);
    }
  }
}
