import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";
import { NonEmptyString } from "../../../../shared/domain/value-objects/non-empty-string.ts";

/**
 * Maximum length, in characters, of a session `next_seed`.
 *
 * The next_seed answers "what should we start the next session with?"
 * It is meant to be brief (a sentence or two) so the next session can
 * pick it up without re-reading the whole `summary`. The cap (2000
 * characters) is intentionally smaller than the summary cap.
 */
const MAX_SESSION_NEXT_SEED_LENGTH = 2000;

/**
 * Value object representing the `next_seed` slot of a `Session`.
 *
 * Mirrors the `sessions.next_seed TEXT` column documented in
 * `docs/03-modelo-datos.md` §4.1 (NULLABLE). The next_seed is the
 * "what to start with next session" hint that allows a future session
 * to chain on this one (the chain link being the `resumed_from` slot
 * on the successor session). The curator typically emits the seed when
 * the session is closing.
 *
 * Invariants (in addition to `NonEmptyString` ones):
 * - The trimmed seed is at most `MAX_SESSION_NEXT_SEED_LENGTH`
 *   characters.
 */
export class SessionNextSeed extends NonEmptyString {
  public static from(raw: string): SessionNextSeed {
    const trimmed = NonEmptyString.normalize(raw, "next_seed");
    if (trimmed.length > MAX_SESSION_NEXT_SEED_LENGTH) {
      throw new InvalidInputError(
        `session next_seed must be at most ${String(MAX_SESSION_NEXT_SEED_LENGTH)} characters (got: ${String(trimmed.length)})`,
        { field: "next_seed" },
      );
    }
    return new SessionNextSeed(trimmed);
  }
}
