import type { DomainEvent } from "../../../../shared/domain/types/domain-event.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { RelationEndpoint } from "../value-objects/relation-endpoint.ts";
import type { RelationId } from "../value-objects/relation-id.ts";
import type { RelationKind } from "../value-objects/relation-kind.ts";

/**
 * Fact: a `Relation` edge was just created.
 *
 * Emitted by `Relation.create(...)`. Subscribers (graph index in the
 * recall layer, audit log) react after persistence confirms the write.
 *
 * Invariants:
 * - `from` and `to` are different endpoints (the aggregate refuses
 *   self-loops).
 * - `eventName` is the stable `"memory.relation-created"` identifier.
 */
export class RelationCreated implements DomainEvent {
  public readonly eventName = "memory.relation-created" as const;
  public readonly occurredAt: Timestamp;
  public readonly workspaceId: WorkspaceId;
  public readonly relationId: RelationId;
  public readonly from: RelationEndpoint;
  public readonly to: RelationEndpoint;
  public readonly kind: RelationKind;

  public constructor(input: {
    workspaceId: WorkspaceId;
    relationId: RelationId;
    from: RelationEndpoint;
    to: RelationEndpoint;
    kind: RelationKind;
    occurredAt: Timestamp;
  }) {
    this.workspaceId = input.workspaceId;
    this.relationId = input.relationId;
    this.from = input.from;
    this.to = input.to;
    this.kind = input.kind;
    this.occurredAt = input.occurredAt;
  }
}
