import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";
import { NonEmptyString } from "../../../../shared/domain/value-objects/non-empty-string.ts";

/**
 * Maximum length, in characters, of a session `summary`.
 *
 * Summaries are the rolling recap of the session that the curator
 * generates by concatenating the per-turn `record_*` events
 * (`docs/01-arquitectura.md` §2.5: "El 'summary' de la sesion cerrada
 * se genera concatenando los `record_*` acumulados"). The cap (8000
 * characters, ~2000 tokens) is generous enough to absorb a long
 * session but bounded so a single value cannot exhaust the recall
 * layer's budget when it surfaces.
 */
const MAX_SESSION_SUMMARY_LENGTH = 8000;

/**
 * Value object representing the `summary` slot of a `Session`.
 *
 * Mirrors the `sessions.summary TEXT` column documented in
 * `docs/03-modelo-datos.md` §4.1 (NULLABLE). The summary is set when
 * the session closes (by `Session.setSummary` and persisted on `end`).
 *
 * Invariants (in addition to `NonEmptyString` ones):
 * - The trimmed summary is at most `MAX_SESSION_SUMMARY_LENGTH`
 *   characters.
 */
export class SessionSummary extends NonEmptyString {
  public static from(raw: string): SessionSummary {
    const trimmed = NonEmptyString.normalize(raw, "session_summary");
    if (trimmed.length > MAX_SESSION_SUMMARY_LENGTH) {
      throw new InvalidInputError(
        `session summary must be at most ${String(MAX_SESSION_SUMMARY_LENGTH)} characters (got: ${String(trimmed.length)})`,
        { field: "session_summary" },
      );
    }
    return new SessionSummary(trimmed);
  }
}
