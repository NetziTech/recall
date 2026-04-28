import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";

/**
 * Set of legal `TaskStatusKind` values. Mirrors the `tasks.status`
 * column documented in `docs/03-modelo-datos.md` §4.7 and the
 * `mem.task` API (`docs/02-protocolo-mcp.md` §4.5).
 *
 * Reconciliation note: the persistence layer in
 * `docs/03-modelo-datos.md` §4.7 names the initial status `pending`
 * (matching `mem.task.list` filter values), while the task spec for
 * this domain uses `todo` because it reads more naturally inside the
 * domain model. The application/persistence layers MUST translate
 * between the wire form (`pending`) and the domain form (`todo`) at
 * their boundary; the domain stays consistent with the documented
 * lifecycle described in `docs/04-capas-contexto.md` §3 (Active Tasks
 * priorities `in_progress` / `blocked` / `pending`).
 */
const TASK_STATUS_KINDS = ["todo", "in_progress", "done", "blocked"] as const;

export type TaskStatusKind = (typeof TASK_STATUS_KINDS)[number];

/**
 * Value object representing the lifecycle status of a `Task`.
 *
 * The legal transitions are enforced at the aggregate level
 * (`Task.start`, `Task.block`, ...). This VO only owns the kind.
 *
 * Invariants:
 * - The wrapped `kind` is always one of the four known values.
 * - Instances are immutable.
 *
 * Equality:
 * - Two `TaskStatus` are equal iff they share the same `kind`.
 */
export class TaskStatus {
  private constructor(public readonly kind: TaskStatusKind) {}

  public static todo(): TaskStatus {
    return new TaskStatus("todo");
  }

  public static inProgress(): TaskStatus {
    return new TaskStatus("in_progress");
  }

  public static done(): TaskStatus {
    return new TaskStatus("done");
  }

  public static blocked(): TaskStatus {
    return new TaskStatus("blocked");
  }

  public static create(raw: string): TaskStatus {
    if (typeof raw !== "string") {
      throw new InvalidInputError("task status must be a string", {
        field: "status",
      });
    }
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      throw new InvalidInputError("task status must not be empty", {
        field: "status",
      });
    }
    if (!TaskStatus.isKind(trimmed)) {
      throw new InvalidInputError(
        `task status must be one of ${TASK_STATUS_KINDS.map((k) => `"${k}"`).join(" | ")} (got: "${raw}")`,
        { field: "status" },
      );
    }
    return new TaskStatus(trimmed);
  }

  public static isKind(candidate: string): candidate is TaskStatusKind {
    for (const known of TASK_STATUS_KINDS) {
      if (known === candidate) return true;
    }
    return false;
  }

  public isTodo(): boolean {
    return this.kind === "todo";
  }

  public isInProgress(): boolean {
    return this.kind === "in_progress";
  }

  public isDone(): boolean {
    return this.kind === "done";
  }

  public isBlocked(): boolean {
    return this.kind === "blocked";
  }

  /**
   * True iff this status is one of the "open" (non-terminal) states.
   * Used by `findOpenByWorkspace` repo queries.
   */
  public isOpen(): boolean {
    return this.kind !== "done";
  }

  public toString(): TaskStatusKind {
    return this.kind;
  }

  public equals(other: TaskStatus): boolean {
    return this.kind === other.kind;
  }
}
