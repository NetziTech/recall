import type { DomainEvent } from "../../../../shared/domain/types/domain-event.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { DecisionId } from "../value-objects/decision-id.ts";

/**
 * Fact: a `Decision` was just recorded.
 *
 * Emitted exactly once per `Decision`, by `Decision.record(...)`.
 * Subscribers (audit log, embedding-queue enqueuer, recall index
 * invalidator) react after the persistence layer confirms the write.
 *
 * Invariants:
 * - `decisionId` is the freshly-minted id for the decision.
 * - `workspaceId` is the parent workspace.
 * - `occurredAt` is the canonical creation instant (matches
 *   `decisions.created_at_ms` documented in
 *   `docs/03-modelo-datos.md` §4.3).
 * - `eventName` is the stable `"memory.decision-recorded"` identifier.
 */
export class DecisionRecorded implements DomainEvent {
  public readonly eventName = "memory.decision-recorded" as const;
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
