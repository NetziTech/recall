import type { DomainEvent } from "../../../../shared/domain/types/domain-event.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { DecisionId } from "../value-objects/decision-id.ts";

/**
 * Fact: a `Decision` was surfaced (recall hit, included in a context
 * bundle, ...).
 *
 * Emitted by `Decision.markUsed(...)`. Subscribers can use this to
 * trigger telemetry on which constitution items the assistant is
 * actually relying on, beyond what the curator's decay pass infers.
 *
 * Invariants:
 * - `eventName` is the stable `"memory.decision-used"` identifier.
 */
export class DecisionUsed implements DomainEvent {
  public readonly eventName = "memory.decision-used" as const;
  public readonly occurredAt: Timestamp;
  public readonly workspaceId: WorkspaceId;
  public readonly decisionId: DecisionId;

  public constructor(input: {
    workspaceId: WorkspaceId;
    decisionId: DecisionId;
    occurredAt: Timestamp;
  }) {
    this.workspaceId = input.workspaceId;
    this.decisionId = input.decisionId;
    this.occurredAt = input.occurredAt;
  }
}
