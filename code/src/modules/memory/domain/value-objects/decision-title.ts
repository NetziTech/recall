import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";
import { NonEmptyString } from "../../../../shared/domain/value-objects/non-empty-string.ts";

/**
 * Maximum length, in characters, of a decision title.
 *
 * The protocol surface (`docs/02-protocolo-mcp.md` §4.4 — the `title`
 * field of `mem.remember({ kind: "decision" })`) is unconstrained, but
 * the `recall` ranker relies on title-vs-rationale length asymmetry to
 * weight the title higher in BM25. Capping at 200 chars keeps titles
 * scannable in CLI output and in the `decisions_fts` snippet preview.
 */
const MAX_TITLE_LENGTH = 200;

/**
 * Value object representing the title of a `Decision`.
 *
 * Mirrors the `decisions.title TEXT NOT NULL` column documented in
 * `docs/03-modelo-datos.md` §4.3.
 *
 * Invariants (in addition to `NonEmptyString` ones):
 * - The trimmed title is at most `MAX_TITLE_LENGTH` characters.
 * - The trimmed title contains no newline characters (titles are
 *   single-line; the rationale is the place for paragraphs).
 */
export class DecisionTitle extends NonEmptyString {
  /**
   * Builds a `DecisionTitle` from raw input. Trims, then enforces the
   * length and "no newlines" invariants.
   */
  public static from(raw: string): DecisionTitle {
    const trimmed = NonEmptyString.normalize(raw, "title");
    if (trimmed.length > MAX_TITLE_LENGTH) {
      throw new InvalidInputError(
        `decision title must be at most ${String(MAX_TITLE_LENGTH)} characters (got: ${String(trimmed.length)})`,
        { field: "title" },
      );
    }
    if (trimmed.includes("\n") || trimmed.includes("\r")) {
      throw new InvalidInputError(
        "decision title must be a single line (no newlines)",
        { field: "title" },
      );
    }
    return new DecisionTitle(trimmed);
  }
}
