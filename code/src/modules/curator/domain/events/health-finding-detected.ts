import type { DomainEvent } from "../../../../shared/domain/types/domain-event.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { CuratorRunId } from "../value-objects/curator-run-id.ts";
import type { HealthFinding } from "../value-objects/health-finding.ts";

/**
 * Fact: the curator detected a self-healing finding during the
 * current run.
 *
 * Emitted by `CuratorRun.recordFinding(...)`. The event carries the
 * full `HealthFinding` so subscribers (logger, JSON-RPC bundler)
 * can route it without re-reading the aggregate state.
 *
 * Per `docs/05-memoria-decay.md` §5, the curator does NOT auto-fix
 * the underlying issue (a stale path is tagged but kept; a decision
 * conflict is flagged but not resolved). The event is therefore an
 * advisory signal — the actual remediation, if any, happens
 * elsewhere.
 *
 * Invariants:
 * - `eventName` is the stable
 *   `"curator.health-finding-detected"` identifier.
 */
export class HealthFindingDetected implements DomainEvent {
  public readonly eventName = "curator.health-finding-detected" as const;
  public readonly occurredAt: Timestamp;
  public readonly workspaceId: WorkspaceId;
  public readonly runId: CuratorRunId;
  public readonly finding: HealthFinding;

  public constructor(input: {
    workspaceId: WorkspaceId;
    runId: CuratorRunId;
    finding: HealthFinding;
    occurredAt: Timestamp;
  }) {
    this.workspaceId = input.workspaceId;
    this.runId = input.runId;
    this.finding = input.finding;
    this.occurredAt = input.occurredAt;
  }
}
