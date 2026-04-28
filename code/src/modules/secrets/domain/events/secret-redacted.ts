import type { DomainEvent } from "../../../../shared/domain/types/domain-event.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { SecretFinding } from "../value-objects/secret-finding.ts";

/**
 * Fact: the secrets scanner replaced a detected secret with the
 * canonical redaction marker, allowing the surrounding payload to flow
 * through the system safely.
 *
 * This event is emitted instead of (NOT in addition to)
 * `SecretBlocked` when the application layer chooses redaction over
 * outright rejection. The two are mutually exclusive per finding: a
 * given secret either gets redacted (the payload continues with a
 * sanitised form) or blocked (the payload is rejected entirely). The
 * `SecretAuditEntry.action` aggregates the choice.
 *
 * Subscribers include the audit-log writer (so the operator can see
 * which payloads were rewritten) and the telemetry pipeline (so SRE
 * dashboards can track the redaction rate).
 *
 * Invariants:
 * - `workspaceId` is the workspace the scan ran in.
 * - `finding` is the immutable VO emitted by the scanner; its
 *   `position.evidence` is already the redacted preview (NOT the raw
 *   secret), per `SecretMatch` invariants.
 * - `eventName` is the stable `"secrets.redacted"` identifier.
 */
export class SecretRedacted implements DomainEvent {
  public readonly eventName = "secrets.redacted" as const;
  public readonly occurredAt: Timestamp;
  public readonly workspaceId: WorkspaceId;
  public readonly finding: SecretFinding;

  public constructor(input: {
    workspaceId: WorkspaceId;
    finding: SecretFinding;
    occurredAt: Timestamp;
  }) {
    this.workspaceId = input.workspaceId;
    this.finding = input.finding;
    this.occurredAt = input.occurredAt;
  }
}
