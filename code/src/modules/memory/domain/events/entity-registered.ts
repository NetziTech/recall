import type { DomainEvent } from "../../../../shared/domain/types/domain-event.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { EntityId } from "../value-objects/entity-id.ts";

/**
 * Fact: an `Entity` was just registered.
 *
 * Emitted exactly once per `Entity`, by `Entity.register(...)`.
 *
 * Invariants:
 * - `eventName` is the stable `"memory.entity-registered"` identifier.
 */
export class EntityRegistered implements DomainEvent {
  public readonly eventName = "memory.entity-registered" as const;
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
