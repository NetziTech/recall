import { Id, type IdValue } from "../../../../shared/domain/value-objects/id.ts";

/**
 * Brand marker for task identifiers.
 */
export type TaskIdBrand = "task";

/**
 * Identifier of a `Task` aggregate.
 *
 * Mirrors `tasks.id TEXT PRIMARY KEY` documented in
 * `docs/03-modelo-datos.md` §4.7.
 */
export class TaskId extends Id<TaskIdBrand> {
  public static from(raw: string): TaskId {
    const normalised = Id.normalize(raw, "task_id");
    return new TaskId(normalised as IdValue<TaskIdBrand>);
  }
}
