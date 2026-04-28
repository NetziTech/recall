import { Id, type IdValue } from "../../../../shared/domain/value-objects/id.ts";

/**
 * Brand marker for relation identifiers.
 */
export type RelationIdBrand = "relation";

/**
 * Identifier of a `Relation` aggregate.
 *
 * Mirrors `relations.id TEXT PRIMARY KEY` (`docs/03-modelo-datos.md`
 * §4.6). A relation is an edge in the entity graph; its identity is its
 * own UUID v7 even though uniqueness is also enforced via the
 * `(from, to, relation)` triple.
 */
export class RelationId extends Id<RelationIdBrand> {
  public static from(raw: string): RelationId {
    const normalised = Id.normalize(raw, "relation_id");
    return new RelationId(normalised as IdValue<RelationIdBrand>);
  }
}
