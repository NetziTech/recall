import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";
import { NonEmptyString } from "../../../../shared/domain/value-objects/non-empty-string.ts";

/**
 * Maximum length, in characters, of an entity name.
 *
 * Entity names are short symbolic labels (`WindowSessions`,
 * `OpenWorkspace`, `editor`) — capping at 200 chars matches the
 * uniqueness expectations of the `UNIQUE (name, entity_kind)` index
 * documented in `docs/03-modelo-datos.md` §4.5 and keeps the
 * `entities_fts` snippet renderable.
 */
const MAX_ENTITY_NAME_LENGTH = 200;

/**
 * Value object representing the human-readable name of an `Entity`.
 *
 * Mirrors `entities.name TEXT NOT NULL` in `docs/03-modelo-datos.md`
 * §4.5.
 *
 * Invariants (in addition to `NonEmptyString` ones):
 * - The trimmed name is at most `MAX_ENTITY_NAME_LENGTH` characters.
 * - No newline characters (entity names are single-line).
 */
export class EntityName extends NonEmptyString {
  public static from(raw: string): EntityName {
    const trimmed = NonEmptyString.normalize(raw, "name");
    if (trimmed.length > MAX_ENTITY_NAME_LENGTH) {
      throw new InvalidInputError(
        `entity name must be at most ${String(MAX_ENTITY_NAME_LENGTH)} characters (got: ${String(trimmed.length)})`,
        { field: "name" },
      );
    }
    if (trimmed.includes("\n") || trimmed.includes("\r")) {
      throw new InvalidInputError(
        "entity name must be a single line (no newlines)",
        { field: "name" },
      );
    }
    return new EntityName(trimmed);
  }
}
