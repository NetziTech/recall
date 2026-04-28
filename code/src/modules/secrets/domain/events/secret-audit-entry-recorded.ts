import type { DomainEvent } from "../../../../shared/domain/types/domain-event.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { AuditEventId } from "../value-objects/audit-event-id.ts";
import type { SecretAction } from "../value-objects/secret-action.ts";
import type { SecretFinding } from "../value-objects/secret-finding.ts";

/**
 * Fact: a `SecretAuditEntry` was added to the persistent audit trail.
 *
 * Emitted exactly once in the lifetime of a `SecretAuditEntry`
 * aggregate, by `SecretAuditEntry.record(...)`. Subscribers (telemetry,
 * external SIEM forwarder, CLI dashboards) react to it after
 * successful persistence.
 *
 * The event carries the FULL set of fields a downstream consumer needs
 * to build a self-describing record, so the event handler does not
 * have to call back into the repository to reconstruct context. The
 * verbosity is deliberate: audit handlers are typically out-of-process
 * pipelines that cannot afford a synchronous database hop.
 *
 * Note on the relationship with `SecretDetected` / `SecretRedacted` /
 * `SecretBlocked`:
 *
 * - The `SecretDetected` event is emitted when the scanner FINDS a
 *   secret. It happens BEFORE the application layer chooses an action.
 * - The `SecretRedacted` / `SecretBlocked` events describe the OUTCOME
 *   of the action.
 * - This event (`SecretAuditEntryRecorded`) describes the
 *   PERSISTENCE of the audit row that aggregates the detection and the
 *   action. A given finding therefore typically generates two events:
 *   one of {`SecretDetected`, `SecretRedacted`, `SecretBlocked`} and
 *   one `SecretAuditEntryRecorded`. Subscribers that care about the
 *   *outcome* listen to the first; subscribers that care about the
 *   *audit trail* listen to this one.
 *
 * Invariants:
 * - All fields are required.
 * - `eventName` is the stable `"secrets.audit-entry-recorded"`
 *   identifier (per the shared `DomainEvent` contract:
 *   `<module>.<event-name-in-past-tense-kebab-case>`).
 */
export class SecretAuditEntryRecorded implements DomainEvent {
  public readonly eventName = "secrets.audit-entry-recorded" as const;
  public readonly occurredAt: Timestamp;
  public readonly auditEventId: AuditEventId;
  public readonly workspaceId: WorkspaceId;
  public readonly finding: SecretFinding;
  public readonly action: SecretAction;

  public constructor(input: {
    auditEventId: AuditEventId;
    workspaceId: WorkspaceId;
    finding: SecretFinding;
    action: SecretAction;
    occurredAt: Timestamp;
  }) {
    this.auditEventId = input.auditEventId;
    this.workspaceId = input.workspaceId;
    this.finding = input.finding;
    this.action = input.action;
    this.occurredAt = input.occurredAt;
  }
}
