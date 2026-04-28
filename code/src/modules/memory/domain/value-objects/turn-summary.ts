import { NonEmptyString } from "../../../../shared/domain/value-objects/non-empty-string.ts";

/**
 * Value object representing the `summary` field of a `Turn`.
 *
 * Mirrors the `turns.summary TEXT NOT NULL` column documented in
 * `docs/03-modelo-datos.md` §4.2. The summary is the compressed textual
 * recap of the turn that the client sends in `mem.remember({kind:
 * "turn"})` (`docs/02-protocolo-mcp.md` §4.4) and the field used to
 * build the searchable_text join for embeddings (`docs/03-modelo-datos.md`
 * §5: `summary + "\n" + intent + "\n" + outcome`).
 *
 * No upper length cap is enforced here on purpose: the layer-bundle
 * builder (Capa 4 in `docs/04-capas-contexto.md` §3.4) is the
 * authoritative truncator — it works at the token level and respects
 * `max_tokens` exactly. Capping characters in the domain would either
 * be too aggressive (rejecting legitimate long turns) or too permissive
 * (still requiring the bundle to truncate). The bundle layer does the
 * right thing.
 *
 * Invariants (in addition to `NonEmptyString` ones):
 * - None beyond the `NonEmptyString` non-empty-after-trim contract.
 */
export class TurnSummary extends NonEmptyString {
  public static from(raw: string): TurnSummary {
    const trimmed = NonEmptyString.normalize(raw, "summary");
    return new TurnSummary(trimmed);
  }
}
