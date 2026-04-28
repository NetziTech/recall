import type { Tags } from "../../../../shared/domain/value-objects/tags.ts";
import type { TaskId } from "../../../memory/domain/value-objects/task-id.ts";
import type { TaskPriority } from "../../../memory/domain/value-objects/task-priority.ts";
import type { TaskStatus } from "../../../memory/domain/value-objects/task-status.ts";
import type { TaskTitle } from "../../../memory/domain/value-objects/task-title.ts";
import type { RelevanceScore } from "./relevance-score.ts";

/**
 * Lightweight reference to a `Task` aggregate, suitable for inclusion in
 * the `open_tasks` layer of a `ContextBundle`.
 *
 * Mirrors the doc's example bundle in `docs/04-capas-contexto.md` §3.3
 * ("Capa 3 — Active Tasks") which renders each task as
 * `[<status>] <title> (<priority>)`. The ref captures exactly those
 * fields plus the id (for deduplication) and the relevance score
 * (the layer is sorted in_progress > blocked > pending > tags-matched,
 * which is implementable as a custom score the application layer
 * computes; the score field is the carrier).
 *
 * The `description` field is intentionally omitted: in the bundle each
 * task is shown as a one-line entry; the description (when present) is
 * a full paragraph that would blow the layer's 400-token cap.
 *
 * Invariants:
 * - All fields are validated value objects.
 * - Instances are immutable.
 *
 * Equality:
 * - Two `TaskRef` are equal iff their ids match.
 */
export class TaskRef {
  private constructor(
    public readonly id: TaskId,
    public readonly title: TaskTitle,
    public readonly status: TaskStatus,
    public readonly priority: TaskPriority,
    public readonly tags: Tags,
    public readonly relevanceScore: RelevanceScore,
  ) {}

  public static of(input: {
    id: TaskId;
    title: TaskTitle;
    status: TaskStatus;
    priority: TaskPriority;
    tags: Tags;
    relevanceScore: RelevanceScore;
  }): TaskRef {
    return new TaskRef(
      input.id,
      input.title,
      input.status,
      input.priority,
      input.tags,
      input.relevanceScore,
    );
  }

  public equals(other: TaskRef): boolean {
    if (this === other) return true;
    return this.id.equals(other.id);
  }
}
