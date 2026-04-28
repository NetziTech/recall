import type { DomainEvent } from "../../../../shared/domain/types/domain-event.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { CuratorRunId } from "../value-objects/curator-run-id.ts";
import type { CuratorRunStats } from "../value-objects/curator-run-stats.ts";

/**
 * Fact: a curator run has finished cleanly.
 *
 * Emitted exactly once per `CuratorRun`, by `CuratorRun.complete(...)`.
 * Carries the final `stats` so subscribers can write the
 * `curator_runs` row in one shot
 * (`docs/03-modelo-datos.md` §4.11) without re-reading the aggregate.
 *
 * Invariants:
 * - `eventName` is the stable `"curator.run-completed"` identifier.
 * - `occurredAt` is the moment the run was marked complete; it is
 *   greater than or equal to the matching `CuratorRunStarted.occurredAt`
 *   (the aggregate enforces this in `complete(...)`).
 */
export class CuratorRunCompleted implements DomainEvent {
  public readonly eventName = "curator.run-completed" as const;
  public readonly occurredAt: Timestamp;
  public readonly workspaceId: WorkspaceId;
  public readonly runId: CuratorRunId;
  public readonly stats: CuratorRunStats;

  public constructor(input: {
    workspaceId: WorkspaceId;
    runId: CuratorRunId;
    stats: CuratorRunStats;
    occurredAt: Timestamp;
  }) {
    this.workspaceId = input.workspaceId;
    this.runId = input.runId;
    this.stats = input.stats;
    this.occurredAt = input.occurredAt;
  }
}
