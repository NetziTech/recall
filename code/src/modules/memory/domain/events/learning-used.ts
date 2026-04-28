import type { DomainEvent } from "../../../../shared/domain/types/domain-event.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { LearningId } from "../value-objects/learning-id.ts";

/**
 * Fact: a `Learning` was surfaced.
 *
 * Emitted by `Learning.markUsed(...)`. Mirrors `DecisionUsed` for the
 * learning kind.
 *
 * Invariants:
 * - `eventName` is the stable `"memory.learning-used"` identifier.
 */
export class LearningUsed implements DomainEvent {
  public readonly eventName = "memory.learning-used" as const;
  public readonly occurredAt: Timestamp;
  public readonly workspaceId: WorkspaceId;
  public readonly learningId: LearningId;

  public constructor(input: {
    workspaceId: WorkspaceId;
    learningId: LearningId;
    occurredAt: Timestamp;
  }) {
    this.workspaceId = input.workspaceId;
    this.learningId = input.learningId;
    this.occurredAt = input.occurredAt;
  }
}
