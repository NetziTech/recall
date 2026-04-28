import { Id, type IdValue } from "../../../../shared/domain/value-objects/id.ts";

/**
 * Brand marker for decision identifiers. Lives at the type level only.
 */
export type DecisionIdBrand = "decision";

/**
 * Identifier of a `Decision` aggregate.
 *
 * Mirrors the `decisions.id TEXT PRIMARY KEY` column documented in
 * `docs/03-modelo-datos.md` §4.3. Inherits the UUID v7 invariants from
 * `Id<DecisionIdBrand>`; the brand pins the type so the compiler refuses
 * to mix it with `LearningId`, `EntityId`, etc.
 */
export class DecisionId extends Id<DecisionIdBrand> {
  /**
   * Builds a `DecisionId` from a raw string. Validates UUID v7 shape via
   * the inherited `normalize` helper.
   */
  public static from(raw: string): DecisionId {
    const normalised = Id.normalize(raw, "decision_id");
    return new DecisionId(normalised as IdValue<DecisionIdBrand>);
  }
}
