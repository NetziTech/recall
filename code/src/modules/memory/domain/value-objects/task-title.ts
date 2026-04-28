import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";
import { NonEmptyString } from "../../../../shared/domain/value-objects/non-empty-string.ts";

/**
 * Maximum length, in characters, of a task title.
 *
 * Tasks are surfaced in Capa 3 of the context bundle
 * (`docs/04-capas-contexto.md` §3.3 — 400-token budget shared by
 * multiple tasks). Capping at 500 chars lets the title carry enough
 * context to be self-explanatory without a description, while still
 * leaving room for several tasks per layer.
 */
const MAX_TASK_TITLE_LENGTH = 500;

/**
 * Value object representing the title of a `Task`.
 *
 * Mirrors `tasks.title TEXT NOT NULL` in `docs/03-modelo-datos.md`
 * §4.7.
 *
 * Invariants (in addition to `NonEmptyString` ones):
 * - The trimmed title is at most `MAX_TASK_TITLE_LENGTH` characters.
 * - No newline characters (single-line; the description holds detail).
 */
export class TaskTitle extends NonEmptyString {
  public static from(raw: string): TaskTitle {
    const trimmed = NonEmptyString.normalize(raw, "title");
    if (trimmed.length > MAX_TASK_TITLE_LENGTH) {
      throw new InvalidInputError(
        `task title must be at most ${String(MAX_TASK_TITLE_LENGTH)} characters (got: ${String(trimmed.length)})`,
        { field: "title" },
      );
    }
    if (trimmed.includes("\n") || trimmed.includes("\r")) {
      throw new InvalidInputError(
        "task title must be a single line (no newlines)",
        { field: "title" },
      );
    }
    return new TaskTitle(trimmed);
  }
}
