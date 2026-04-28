import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";
import { NonEmptyString } from "../../../../shared/domain/value-objects/non-empty-string.ts";

/**
 * Maximum length, in characters, of a turn `intent`.
 *
 * Intents are short statements of what the user (or the assistant) was
 * trying to do during the turn. The cap (1000 characters) is generous
 * enough to fit a paragraph while preventing pathological values from
 * polluting the FTS5 shadow table or the embedding searchable_text
 * (`docs/03-modelo-datos.md` §5).
 */
const MAX_TURN_INTENT_LENGTH = 1000;

/**
 * Value object representing the `intent` slot of a `Turn`.
 *
 * Mirrors the `turns.intent TEXT` column documented in
 * `docs/03-modelo-datos.md` §4.2. The intent is OPTIONAL at the
 * persistence layer (the column is nullable); the aggregate models that
 * by accepting `null` for the field while requiring this VO to wrap a
 * non-empty value when present. This lets recall layers (Capa 5,
 * `docs/04-capas-contexto.md` §3.5) join `summary + intent + outcome`
 * for the embedder without mistaking a sentinel for legitimate text.
 *
 * Invariants (in addition to `NonEmptyString` ones):
 * - The trimmed intent is at most `MAX_TURN_INTENT_LENGTH` characters.
 */
export class TurnIntent extends NonEmptyString {
  public static from(raw: string): TurnIntent {
    const trimmed = NonEmptyString.normalize(raw, "intent");
    if (trimmed.length > MAX_TURN_INTENT_LENGTH) {
      throw new InvalidInputError(
        `turn intent must be at most ${String(MAX_TURN_INTENT_LENGTH)} characters (got: ${String(trimmed.length)})`,
        { field: "intent" },
      );
    }
    return new TurnIntent(trimmed);
  }
}
