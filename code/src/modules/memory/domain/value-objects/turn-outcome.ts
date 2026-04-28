import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";
import { NonEmptyString } from "../../../../shared/domain/value-objects/non-empty-string.ts";

/**
 * Maximum length, in characters, of a turn `outcome`.
 *
 * Outcomes are short statements of what actually happened by the end of
 * the turn (success, failure, partial result, ...). The cap (2000
 * characters) is twice the intent cap because outcomes often summarise
 * multi-step results, but is still bounded so a single turn cannot
 * dominate the embedding searchable_text (`docs/03-modelo-datos.md`
 * §5).
 */
const MAX_TURN_OUTCOME_LENGTH = 2000;

/**
 * Value object representing the `outcome` slot of a `Turn`.
 *
 * Mirrors the `turns.outcome TEXT` column documented in
 * `docs/03-modelo-datos.md` §4.2. Like `intent`, the outcome is
 * OPTIONAL at the persistence layer; the aggregate accepts `null` for
 * the field but requires this VO to wrap a non-empty value when
 * present.
 *
 * Invariants (in addition to `NonEmptyString` ones):
 * - The trimmed outcome is at most `MAX_TURN_OUTCOME_LENGTH` characters.
 */
export class TurnOutcome extends NonEmptyString {
  public static from(raw: string): TurnOutcome {
    const trimmed = NonEmptyString.normalize(raw, "outcome");
    if (trimmed.length > MAX_TURN_OUTCOME_LENGTH) {
      throw new InvalidInputError(
        `turn outcome must be at most ${String(MAX_TURN_OUTCOME_LENGTH)} characters (got: ${String(trimmed.length)})`,
        { field: "outcome" },
      );
    }
    return new TurnOutcome(trimmed);
  }
}
