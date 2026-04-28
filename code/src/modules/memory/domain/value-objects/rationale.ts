import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";
import { NonEmptyString } from "../../../../shared/domain/value-objects/non-empty-string.ts";

/**
 * Maximum length, in characters, of a decision's rationale.
 *
 * The protocol contract (`docs/02-protocolo-mcp.md` §4.4) does not
 * specify a cap, but the recall layer pre-allocates per-entry token
 * budgets in the layered context bundle (`docs/04-capas-contexto.md`
 * §3.2: capa 2 has a 600-token budget shared across multiple
 * decisions). Capping the field at 5000 characters keeps each rationale
 * well under that ceiling even at worst-case 1 token / 4 chars while
 * still letting the writer expand the reasoning beyond a sentence.
 */
const MAX_RATIONALE_LENGTH = 5000;

/**
 * Value object representing the textual rationale that justifies a
 * `Decision`.
 *
 * Mirrors `decisions.rationale TEXT NOT NULL` in
 * `docs/03-modelo-datos.md` §4.3.
 *
 * Invariants (in addition to `NonEmptyString` ones):
 * - The trimmed rationale is at most `MAX_RATIONALE_LENGTH` characters.
 * - Newlines are allowed (rationales often contain bullet lists).
 */
export class Rationale extends NonEmptyString {
  public static from(raw: string): Rationale {
    const trimmed = NonEmptyString.normalize(raw, "rationale");
    if (trimmed.length > MAX_RATIONALE_LENGTH) {
      throw new InvalidInputError(
        `rationale must be at most ${String(MAX_RATIONALE_LENGTH)} characters (got: ${String(trimmed.length)})`,
        { field: "rationale" },
      );
    }
    return new Rationale(trimmed);
  }
}
