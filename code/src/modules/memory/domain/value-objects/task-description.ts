import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";
import { NonEmptyString } from "../../../../shared/domain/value-objects/non-empty-string.ts";

/**
 * Maximum length, in characters, of a task description.
 *
 * Tasks descriptions are optional — when present, they elaborate on the
 * title with multi-paragraph context. 5000 characters is generous
 * enough for a small spec while still bounding the storage cost.
 */
const MAX_TASK_DESCRIPTION_LENGTH = 5000;

/**
 * Value object representing the optional textual description of a
 * `Task`.
 *
 * Mirrors `tasks.description TEXT` (nullable) in
 * `docs/03-modelo-datos.md` §4.7.
 *
 * The aggregate decides whether the field is present at all (`null`
 * means "no description"); when present, the value object enforces the
 * non-empty + length-cap contract.
 */
export class TaskDescription extends NonEmptyString {
  public static from(raw: string): TaskDescription {
    const trimmed = NonEmptyString.normalize(raw, "description");
    if (trimmed.length > MAX_TASK_DESCRIPTION_LENGTH) {
      throw new InvalidInputError(
        `task description must be at most ${String(MAX_TASK_DESCRIPTION_LENGTH)} characters (got: ${String(trimmed.length)})`,
        { field: "description" },
      );
    }
    return new TaskDescription(trimmed);
  }
}
