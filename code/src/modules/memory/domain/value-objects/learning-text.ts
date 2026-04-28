import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";
import { NonEmptyString } from "../../../../shared/domain/value-objects/non-empty-string.ts";

/**
 * Maximum length, in characters, of the body of a `Learning`.
 *
 * Learnings are atomic notes ("siempre canonicalizar paths antes de
 * comparar", `docs/02-protocolo-mcp.md` §4.4 example). They are
 * intentionally short so multiple can fit in capa 5 of the context
 * bundle (`docs/04-capas-contexto.md` §3.5). 2000 characters give
 * enough room for a multi-sentence explanation while still respecting
 * the layer budget.
 */
const MAX_LEARNING_LENGTH = 2000;

/**
 * Value object representing the body text of a `Learning`.
 *
 * Mirrors `learnings.content TEXT NOT NULL` in
 * `docs/03-modelo-datos.md` §4.4.
 *
 * Invariants (in addition to `NonEmptyString` ones):
 * - The trimmed text is at most `MAX_LEARNING_LENGTH` characters.
 */
export class LearningText extends NonEmptyString {
  public static from(raw: string): LearningText {
    const trimmed = NonEmptyString.normalize(raw, "content");
    if (trimmed.length > MAX_LEARNING_LENGTH) {
      throw new InvalidInputError(
        `learning text must be at most ${String(MAX_LEARNING_LENGTH)} characters (got: ${String(trimmed.length)})`,
        { field: "content" },
      );
    }
    return new LearningText(trimmed);
  }
}
