import type { DomainEvent } from "../../../../shared/domain/types/domain-event.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { DecisionId } from "../value-objects/decision-id.ts";

/**
 * Fact: a `Decision` was superseded by a newer one.
 *
 * Emitted by `Decision.supersede(...)` after the supersedeship has
 * been validated (the decision was active and the successor is not
 * itself). The recall layer consumes this event to mark the decision
 * as inactive in any in-memory index it maintains.
 *
 * Invariants:
 * - `previousDecisionId` is the decision that was just retired.
 * - `successorDecisionId` is the newer decision that replaces it.
 *   Different from `previousDecisionId` (the aggregate refuses
 *   self-supersession).
 * - `eventName` is the stable `"memory.decision-superseded"` identifier.
 */
export class DecisionSuperseded implements DomainEvent {
  public readonly eventName = "memory.decision-superseded" as const;
  public readonly occurredAt: Timestamp;
  public readonly workspaceId: WorkspaceId;
  public readonly previousDecisionId: DecisionId;
  public readonly successorDecisionId: DecisionId;

  public constructor(input: {
    workspaceId: WorkspaceId;
    previousDecisionId: DecisionId;
    successorDecisionId: DecisionId;
    occurredAt: Timestamp;
  }) {
    this.workspaceId = input.workspaceId;
    this.previousDecisionId = input.previousDecisionId;
    this.successorDecisionId = input.successorDecisionId;
    this.occurredAt = input.occurredAt;
  }
}
