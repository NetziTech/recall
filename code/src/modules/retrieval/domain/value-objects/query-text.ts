import { InvalidQueryError } from "../errors/invalid-query-error.ts";

/**
 * Maximum number of characters a `QueryText` is allowed to carry.
 *
 * The cap exists for two reasons:
 * - The embedder ports (`Embedder.embed(...)`) feed the text to a
 *   transformer with a fixed token window (BGE-Small-EN-1.5 has 512
 *   tokens — see `docs/06-stack-tecnico.md` §6). A char ceiling of
 *   5000 leaves headroom even after worst-case tokenisation.
 * - FTS5 queries with very long bodies degrade O(n) on the index
 *   walk; the BM25 scorer has no use for a 50K-char query.
 *
 * The number is the same one mentioned in `docs/02-protocolo-mcp.md`
 * §4.3 (the `query` field has no explicit cap there, but the spirit of
 * the protocol — "queries son cortas y especificas" — matches this
 * bound). If the embedder model changes, only this constant moves.
 */
const MAX_QUERY_TEXT_LENGTH = 5000;

/**
 * Value object representing the textual portion of a recall query.
 *
 * Wraps a non-empty string trimmed of leading/trailing whitespace and
 * capped at `MAX_QUERY_TEXT_LENGTH` characters. The wrapper exists so
 * the recall pipeline does not have to validate the same string twice
 * (once for FTS5, once for the embedder); both adapters consume the VO
 * after the invariants have been checked.
 *
 * Invariants:
 * - The wrapped string is trimmed of leading/trailing whitespace.
 * - The trimmed string contains at least one character.
 * - The trimmed string is no longer than `MAX_QUERY_TEXT_LENGTH`
 *   characters.
 * - Instances are immutable.
 *
 * Equality:
 * - Two `QueryText` are equal iff their trimmed values match
 *   character-for-character (case-sensitive — capitalisation can be a
 *   semantic signal in code-shaped queries like `"WindowSessions"`).
 */
export class QueryText {
  private constructor(public readonly value: string) {}

  /**
   * Builds a `QueryText` from a raw string.
   */
  public static create(raw: string): QueryText {
    if (typeof raw !== "string") {
      throw new InvalidQueryError("query text must be a string", {
        field: "query",
      });
    }
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      throw new InvalidQueryError(
        "query text must contain at least one non-whitespace character",
        { field: "query" },
      );
    }
    if (trimmed.length > MAX_QUERY_TEXT_LENGTH) {
      throw new InvalidQueryError(
        `query text must be at most ${String(MAX_QUERY_TEXT_LENGTH)} characters (got: ${String(trimmed.length)})`,
        { field: "query" },
      );
    }
    return new QueryText(trimmed);
  }

  public toString(): string {
    return this.value;
  }

  public length(): number {
    return this.value.length;
  }

  public equals(other: QueryText): boolean {
    if (this === other) return true;
    return this.value === other.value;
  }
}
