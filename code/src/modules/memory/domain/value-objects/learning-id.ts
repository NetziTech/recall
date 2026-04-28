import { Id, type IdValue } from "../../../../shared/domain/value-objects/id.ts";

/**
 * Brand marker for learning identifiers. Lives at the type level only.
 */
export type LearningIdBrand = "learning";

/**
 * Identifier of a `Learning` aggregate.
 *
 * Mirrors `learnings.id TEXT PRIMARY KEY` documented in
 * `docs/03-modelo-datos.md` §4.4. Inherits UUID v7 invariants from
 * `Id<LearningIdBrand>`.
 */
export class LearningId extends Id<LearningIdBrand> {
  public static from(raw: string): LearningId {
    const normalised = Id.normalize(raw, "learning_id");
    return new LearningId(normalised as IdValue<LearningIdBrand>);
  }
}
