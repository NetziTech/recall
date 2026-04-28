import { Id, type IdValue } from "../../../../shared/domain/value-objects/id.ts";

/**
 * Brand marker for entity identifiers. Lives at the type level only.
 *
 * "Entity" here means the *software-domain entity* persisted in the
 * `entities` table (`docs/03-modelo-datos.md` §4.5) — a struct, module,
 * service, concept, etc. that the memory describes. It is unrelated to
 * the DDD term "entity".
 */
export type EntityIdBrand = "entity";

/**
 * Identifier of an `Entity` aggregate.
 */
export class EntityId extends Id<EntityIdBrand> {
  public static from(raw: string): EntityId {
    const normalised = Id.normalize(raw, "entity_id");
    return new EntityId(normalised as IdValue<EntityIdBrand>);
  }
}
