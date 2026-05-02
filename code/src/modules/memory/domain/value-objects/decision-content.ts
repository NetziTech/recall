import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";
import { NonEmptyString } from "../../../../shared/domain/value-objects/non-empty-string.ts";

/**
 * Maximum length, in characters, of a decision's `content` body.
 *
 * Where this comes from:
 *   - `docs/02-protocolo-mcp.md §4.4` documents `content: string` as
 *     the canonical full-text field for `mem.remember`. The protocol
 *     does not pin a cap.
 *   - The retrieval bundle (`docs/04-capas-contexto.md §3.2`)
 *     pre-allocates per-entry token budgets — at worst-case 4 chars
 *     per token, 50,000 chars ≈ 12.5K tokens, which still fits inside
 *     a single recall envelope's budget without forcing the bundle
 *     planner to truncate aggressively.
 *   - Decisions occasionally carry long-form rationale plus context
 *     ("ADR-style" entries are common in real workspaces); 50,000
 *     leaves room for an ADR full body without artificially clipping
 *     legitimate inputs.
 *
 * The cap is well above `Rationale`'s 5,000 because `content` is
 * explicitly the "long-form" field — short-form lives in `rationale`.
 */
const MAX_CONTENT_LENGTH = 50_000;

/**
 * Value object for the canonical `content` body of a `Decision`.
 *
 * Mirrors `decisions.content TEXT NOT NULL` as added by migration
 * `008__decisions-content.sql`. The wire schema (`docs/02 §4.4`)
 * has always required this field for every `mem.remember` kind, but
 * the original schema lacked the column and the facade silently
 * dropped the value (Bug B-MCP-4 / issue #3). Adding the VO closes
 * the loop on the domain side.
 *
 * Invariants (in addition to {@link NonEmptyString}'s):
 * - The trimmed content is at most {@link MAX_CONTENT_LENGTH}
 *   characters. Inputs above the cap raise {@link InvalidInputError}
 *   with a precise length-mismatch message so the wire boundary can
 *   surface a structured -32602 error.
 * - Newlines are allowed — long-form decision bodies routinely span
 *   paragraphs and bullet lists.
 *
 * Relationship with `Rationale`:
 * - `Rationale` is the SHORT WHY (the justification, capped at 5,000
 *   chars).
 * - `DecisionContent` is the LONG BODY (the full text the client
 *   wants to persist verbatim, capped at 50,000 chars).
 * - When the wire client supplies only one of the two, the facade
 *   falls back: missing `content` → reuses `rationale`; missing
 *   `rationale` → derives a one-line summary from `content`. The VO
 *   layer is unaware of those fallbacks — it sees only well-formed,
 *   non-empty strings.
 */
export class DecisionContent extends NonEmptyString {
  public static from(raw: string): DecisionContent {
    const trimmed = NonEmptyString.normalize(raw, "content");
    if (trimmed.length > MAX_CONTENT_LENGTH) {
      throw new InvalidInputError(
        `decision content must be at most ${String(MAX_CONTENT_LENGTH)} characters (got: ${String(trimmed.length)})`,
        { field: "content" },
      );
    }
    return new DecisionContent(trimmed);
  }
}
