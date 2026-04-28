import type { DomainEvent } from "../../../../shared/domain/types/domain-event.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { EntityId } from "../value-objects/entity-id.ts";

/**
 * Fact: the description of an `Entity` was updated (or set for the
 * first time).
 *
 * Emitted by `Entity.updateDescription(...)`. The embedding queue
 * subscriber re-enqueues the entry because the searchable text
 * (`name + entity_kind + "\n" + description`, per
 * `docs/03-modelo-datos.md` §5) has changed.
 *
 * Invariants:
 * - `eventName` is the stable `"memory.entity-described"` identifier.
 */
export class EntityDescribed implements DomainEvent {
  public readonly eventName = "memory.entity-described" as const;
  public readonly occurredAt: Timestamp;
  public readonly workspaceId: WorkspaceId;
  public readonly entityId: EntityId;

  public constructor(input: {
    workspaceId: WorkspaceId;
    entityId: EntityId;
    occurredAt: Timestamp;
  }) {
    this.workspaceId = input.workspaceId;
    this.entityId = input.entityId;
    this.occurredAt = input.occurredAt;
  }
}
