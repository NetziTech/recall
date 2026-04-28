import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";
import { NonEmptyString } from "../../../../shared/domain/value-objects/non-empty-string.ts";

/**
 * Maximum length, in characters, of a session `intent`.
 *
 * Intents are short statements of what the user is trying to accomplish
 * during the session ("implement editor module fase 2", "debug
 * window cleanup", ...). The cap (1000 characters) is generous enough
 * to fit a paragraph but bounded so the intent column does not become
 * a free-form notepad — for that there is `summary` and the
 * `metadata_json` open questions.
 */
const MAX_SESSION_INTENT_LENGTH = 1000;

/**
 * Value object representing the `intent` slot of a `Session`.
 *
 * Mirrors the `sessions.intent TEXT` column documented in
 * `docs/03-modelo-datos.md` §4.1 (NULLABLE — the column has no NOT NULL
 * constraint). The aggregate accepts `null` for the field to model the
 * "we did not declare an intent" case, but when present this VO
 * enforces the non-empty-after-trim and length-cap invariants. Powers
 * the rendering of Capa 1 (System Identity) of the context bundle
 * (`docs/04-capas-contexto.md` §3.1: "Sesion: implementar feature X").
 *
 * Invariants (in addition to `NonEmptyString` ones):
 * - The trimmed intent is at most `MAX_SESSION_INTENT_LENGTH`
 *   characters.
 */
export class SessionIntent extends NonEmptyString {
  public static from(raw: string): SessionIntent {
    const trimmed = NonEmptyString.normalize(raw, "session_intent");
    if (trimmed.length > MAX_SESSION_INTENT_LENGTH) {
      throw new InvalidInputError(
        `session intent must be at most ${String(MAX_SESSION_INTENT_LENGTH)} characters (got: ${String(trimmed.length)})`,
        { field: "session_intent" },
      );
    }
    return new SessionIntent(trimmed);
  }
}
