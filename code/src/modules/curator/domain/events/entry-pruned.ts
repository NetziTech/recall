import type { DomainEvent } from "../../../../shared/domain/types/domain-event.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { AffectedEntryRef } from "../value-objects/affected-entry-ref.ts";
import type { CuratorRunId } from "../value-objects/curator-run-id.ts";
import type { PrunedReason } from "../value-objects/pruned-reason.ts";

/**
 * Fact: the curator pruned a memory entry during the current run.
 *
 * Emitted by `CuratorRun.recordPrune(...)`. The event carries the
 * `(kind, id)` reference and the `reason` so subscribers can:
 * 1. Read the original row from the appropriate kind-specific
 *    repository.
 * 2. Persist a snapshot in the `pruned` table via
 *    `PrunedEntryRepository.save(...)`.
 * 3. Delete the source row.
 *
 * Per `docs/05-memoria-decay.md` §4, pruning is reversible for 30
 * days (the audit row stays in `pruned`). The aggregate itself does
 * NOT touch the kind-specific tables; it only records the intent so
 * the application layer can sequence the actual deletion.
 *
 * Invariants:
 * - `eventName` is the stable `"curator.entry-pruned"` identifier.
 */
export class EntryPruned implements DomainEvent {
  public readonly eventName = "curator.entry-pruned" as const;
  public readonly occurredAt: Timestamp;
  public readonly workspaceId: WorkspaceId;
  public readonly runId: CuratorRunId;
  public readonly entryRef: AffectedEntryRef;
  public readonly reason: PrunedReason;

  public constructor(input: {
    workspaceId: WorkspaceId;
    runId: CuratorRunId;
    entryRef: AffectedEntryRef;
    reason: PrunedReason;
    occurredAt: Timestamp;
  }) {
    this.workspaceId = input.workspaceId;
    this.runId = input.runId;
    this.entryRef = input.entryRef;
    this.reason = input.reason;
    this.occurredAt = input.occurredAt;
  }
}
