import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { Entity } from "../aggregates/entity.ts";
import type { EntityId } from "../value-objects/entity-id.ts";
import type { EntityKind } from "../value-objects/entity-kind.ts";
import type { EntityName } from "../value-objects/entity-name.ts";

/**
 * Driven port for persisting and reloading the `Entity` aggregate.
 *
 * Mirrors the `entities` table contract from
 * `docs/03-modelo-datos.md` §4.5. The persistence schema enforces
 * `UNIQUE (name, entity_kind)`; `findByNameAndKind` lets the
 * application layer detect collisions before calling
 * `Entity.register(...)`.
 *
 * Contract:
 * - `findById` and `findByNameAndKind` return `null` on miss.
 * - `save` is atomic and may upsert.
 */
export interface EntityRepository {
  findById(id: EntityId): Promise<Entity | null>;

  save(entity: Entity): Promise<void>;

  /**
   * Returns every entity in `workspaceId`, optionally filtered by
   * `kind`.
   */
  findByWorkspace(
    workspaceId: WorkspaceId,
    kind?: EntityKind,
  ): Promise<readonly Entity[]>;

  /**
   * Returns the entity matching the `(name, kind)` uniqueness
   * constraint, or `null` when none exists. Used by use cases that
   * need to detect duplicates before issuing a `register`.
   */
  findByNameAndKind(
    workspaceId: WorkspaceId,
    name: EntityName,
    kind: EntityKind,
  ): Promise<Entity | null>;
}
