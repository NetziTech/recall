import type { DomainEvent } from "../../../../shared/domain/types/domain-event.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { LearningId } from "../value-objects/learning-id.ts";

/**
 * Fact: a `Learning` was consolidated into another one by the
 * curator's de-duplication pass.
 *
 * Emitted by `Learning.consolidateInto(...)`. The recall layer uses
 * this to skip the consolidated entry from active queries (per
 * `docs/03-modelo-datos.md` §4.4: `consolidated_into IS NULL` filters
 * the active set).
 *
 * Invariants:
 * - `consolidatedLearningId` is the entry that was folded.
 * - `targetLearningId` is the entry it was folded into. Different from
 *   `consolidatedLearningId` (the aggregate refuses self-consolidation).
 * - `eventName` is the stable `"memory.learning-consolidated"` identifier.
 */
export class LearningConsolidated implements DomainEvent {
  public readonly eventName = "memory.learning-consolidated" as const;
  public readonly occurredAt: Timestamp;
  public readonly workspaceId: WorkspaceId;
  public readonly consolidatedLearningId: LearningId;
  public readonly targetLearningId: LearningId;

  public constructor(input: {
    workspaceId: WorkspaceId;
    consolidatedLearningId: LearningId;
    targetLearningId: LearningId;
    occurredAt: Timestamp;
  }) {
    this.workspaceId = input.workspaceId;
    this.consolidatedLearningId = input.consolidatedLearningId;
    this.targetLearningId = input.targetLearningId;
    this.occurredAt = input.occurredAt;
  }
}
