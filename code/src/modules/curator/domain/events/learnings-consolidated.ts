import type { DomainEvent } from "../../../../shared/domain/types/domain-event.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { ConsolidationPair } from "../value-objects/consolidation-pair.ts";
import type { CuratorRunId } from "../value-objects/curator-run-id.ts";

/**
 * Fact: the curator recorded a consolidation pair during the current
 * run.
 *
 * Emitted by `CuratorRun.recordConsolidation(...)`. The event carries
 * the `ConsolidationPair` (winner, loser, cosine score) so the
 * application-layer subscriber can:
 * 1. Load the loser aggregate from the `LearningRepository`.
 * 2. Call `Learning.consolidateInto(winnerId)`.
 * 3. Save the loser and drain its events.
 *
 * Note on naming: the past-tense `consolidated` reflects the
 * recording of the recommendation, not the actual fold of the
 * underlying aggregate. The fold itself produces a separate
 * `memory.learning-consolidated` event from the `Learning` aggregate.
 * This curator-level event is the audit-trail bookkeeping fact.
 *
 * Invariants:
 * - `eventName` is the stable
 *   `"curator.learnings-consolidated"` identifier.
 */
export class LearningsConsolidated implements DomainEvent {
  public readonly eventName = "curator.learnings-consolidated" as const;
  public readonly occurredAt: Timestamp;
  public readonly workspaceId: WorkspaceId;
  public readonly runId: CuratorRunId;
  public readonly pair: ConsolidationPair;

  public constructor(input: {
    workspaceId: WorkspaceId;
    runId: CuratorRunId;
    pair: ConsolidationPair;
    occurredAt: Timestamp;
  }) {
    this.workspaceId = input.workspaceId;
    this.runId = input.runId;
    this.pair = input.pair;
    this.occurredAt = input.occurredAt;
  }
}
