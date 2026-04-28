import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";

/**
 * Set of legal `TaskPriorityKind` values.
 *
 * Reconciliation note: the persistence schema in
 * `docs/03-modelo-datos.md` §4.7 lists `priority TEXT NOT NULL DEFAULT
 * 'medium'` without enumerating values; the `mem.task` API in
 * `docs/02-protocolo-mcp.md` §4.5 lists `"low" | "medium" | "high"`. The
 * domain extends the catalogue with `"critical"` as a future-proofing
 * step (Capa 3 in `docs/04-capas-contexto.md` §3 mentions `critical`
 * implicitly when discussing severity-driven priorities). The API
 * adapter is free to reject `critical` until the protocol catches up;
 * the domain is the authoritative source.
 */
const TASK_PRIORITY_KINDS = ["low", "medium", "high", "critical"] as const;

export type TaskPriorityKind = (typeof TASK_PRIORITY_KINDS)[number];

/**
 * Numeric ranking used to sort tasks. Higher = more urgent.
 */
const PRIORITY_RANK: Readonly<Record<TaskPriorityKind, number>> =
  Object.freeze({
    low: 0,
    medium: 1,
    high: 2,
    critical: 3,
  });

/**
 * Value object representing the priority of a `Task`.
 *
 * Invariants:
 * - The wrapped `kind` is one of the four known values.
 * - Instances are immutable.
 *
 * Equality:
 * - Two `TaskPriority` are equal iff they share the same `kind`.
 */
export class TaskPriority {
  private constructor(public readonly kind: TaskPriorityKind) {}

  public static low(): TaskPriority {
    return new TaskPriority("low");
  }

  public static medium(): TaskPriority {
    return new TaskPriority("medium");
  }

  public static high(): TaskPriority {
    return new TaskPriority("high");
  }

  public static critical(): TaskPriority {
    return new TaskPriority("critical");
  }

  public static create(raw: string): TaskPriority {
    if (typeof raw !== "string") {
      throw new InvalidInputError("task priority must be a string", {
        field: "priority",
      });
    }
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      throw new InvalidInputError("task priority must not be empty", {
        field: "priority",
      });
    }
    if (!TaskPriority.isKind(trimmed)) {
      throw new InvalidInputError(
        `task priority must be one of ${TASK_PRIORITY_KINDS.map((k) => `"${k}"`).join(" | ")} (got: "${raw}")`,
        { field: "priority" },
      );
    }
    return new TaskPriority(trimmed);
  }

  public static isKind(candidate: string): candidate is TaskPriorityKind {
    for (const known of TASK_PRIORITY_KINDS) {
      if (known === candidate) return true;
    }
    return false;
  }

  public rank(): number {
    return PRIORITY_RANK[this.kind];
  }

  public isHigherThan(other: TaskPriority): boolean {
    return this.rank() > other.rank();
  }

  public toString(): TaskPriorityKind {
    return this.kind;
  }

  public equals(other: TaskPriority): boolean {
    return this.kind === other.kind;
  }
}
