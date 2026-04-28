import type { DomainEvent } from "../../../../shared/domain/types/domain-event.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { CuratorRunId } from "../value-objects/curator-run-id.ts";
import type { CuratorRunTrigger } from "../value-objects/curator-run-trigger.ts";

/**
 * Fact: a curator run has just started.
 *
 * Emitted exactly once per `CuratorRun`, by `CuratorRun.start(...)`.
 * Subscribers typically:
 * - Open a structured logger span ("curator-run", `runId`).
 * - Snapshot the database (per `docs/05-memoria-decay.md` §6
 *   "Pasada completa", step 1).
 *
 * Invariants:
 * - `eventName` is the stable `"curator.run-started"` identifier.
 */
export class CuratorRunStarted implements DomainEvent {
  public readonly eventName = "curator.run-started" as const;
  public readonly occurredAt: Timestamp;
  public readonly workspaceId: WorkspaceId;
  public readonly runId: CuratorRunId;
  public readonly trigger: CuratorRunTrigger;

  public constructor(input: {
    workspaceId: WorkspaceId;
    runId: CuratorRunId;
    trigger: CuratorRunTrigger;
    occurredAt: Timestamp;
  }) {
    this.workspaceId = input.workspaceId;
    this.runId = input.runId;
    this.trigger = input.trigger;
    this.occurredAt = input.occurredAt;
  }
}
