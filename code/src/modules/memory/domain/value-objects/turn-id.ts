import { Id, type IdValue } from "../../../../shared/domain/value-objects/id.ts";

/**
 * Brand marker for turn identifiers.
 */
export type TurnIdBrand = "turn";

/**
 * Identifier of a `Turn` aggregate.
 *
 * Mirrors `turns.id TEXT PRIMARY KEY` (`docs/03-modelo-datos.md` §4.2).
 */
export class TurnId extends Id<TurnIdBrand> {
  public static from(raw: string): TurnId {
    const normalised = Id.normalize(raw, "turn_id");
    return new TurnId(normalised as IdValue<TurnIdBrand>);
  }
}
