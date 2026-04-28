import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";
import { NonEmptyString } from "../../../../shared/domain/value-objects/non-empty-string.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";

/**
 * Maximum length, in characters, of the body of an open question.
 *
 * Open questions are short prompts ("¿Vitest setup va en fase 2 o lo
 * postergamos?", `docs/04-capas-contexto.md` §3.7). The cap (1000
 * characters) is generous enough to fit a paragraph of context but
 * bounded so the layer-7 budget (300 tokens) is not exhausted by a
 * single question.
 */
const MAX_OPEN_QUESTION_LENGTH = 1000;

/**
 * Inner text of an open question. Stored as a typed wrapper rather than
 * a raw string so the non-empty + length invariants live in one place.
 */
export class OpenQuestionText extends NonEmptyString {
  public static from(raw: string): OpenQuestionText {
    const trimmed = NonEmptyString.normalize(raw, "open_question");
    if (trimmed.length > MAX_OPEN_QUESTION_LENGTH) {
      throw new InvalidInputError(
        `open question must be at most ${String(MAX_OPEN_QUESTION_LENGTH)} characters (got: ${String(trimmed.length)})`,
        { field: "open_question" },
      );
    }
    return new OpenQuestionText(trimmed);
  }
}

/**
 * Value object representing a single open question recorded in a
 * `Session`'s `metadata_json.open_questions` collection.
 *
 * Open questions are the data behind Capa 7 of the context bundle
 * (`docs/04-capas-contexto.md` §3.7): unresolved prompts that the
 * assistant captured during a session and that the curator surfaces in
 * the next bundle so the user can answer or close them. The persistence
 * layer flattens the list into the `sessions.metadata_json` blob
 * (`docs/03-modelo-datos.md` §4.1); the domain models each entry as a
 * dedicated VO so the (text, timestamp) pair stays together and the
 * invariants are enforced uniformly.
 *
 * Invariants:
 * - `text` is a non-empty `OpenQuestionText`.
 * - `askedAt` is the moment the question was added to the session.
 * - Instances are immutable.
 *
 * Equality:
 * - Two `OpenQuestion` are equal iff their `text` and `askedAt` match.
 */
export class OpenQuestion {
  private constructor(
    public readonly text: OpenQuestionText,
    public readonly askedAt: Timestamp,
  ) {}

  /**
   * Builds an `OpenQuestion` from a previously-validated `OpenQuestionText`
   * and the moment it was asked.
   */
  public static of(text: OpenQuestionText, askedAt: Timestamp): OpenQuestion {
    return new OpenQuestion(text, askedAt);
  }

  /**
   * Convenience factory that wraps a raw string into an
   * `OpenQuestionText` first.
   */
  public static from(rawText: string, askedAt: Timestamp): OpenQuestion {
    return new OpenQuestion(OpenQuestionText.from(rawText), askedAt);
  }

  public equals(other: OpenQuestion): boolean {
    if (this === other) return true;
    if (!this.text.equals(other.text)) return false;
    return this.askedAt.equals(other.askedAt);
  }
}
