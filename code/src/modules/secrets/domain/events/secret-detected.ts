import type { DomainEvent } from "../../../../shared/domain/types/domain-event.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { SecretFinding } from "../value-objects/secret-finding.ts";

/**
 * Fact: the secrets scanner detected one or more secret signatures in a
 * payload it inspected.
 *
 * Emitted by the application layer (NOT by the scanner directly: the
 * scanner is a port that returns a `SanitizedText`; the use case
 * decides which findings translate to events). Subscribers include the
 * audit-log writer that materialises the `SecretAuditEntry` aggregate
 * and the telemetry pipeline (`docs/11-seguridad-modos.md` §6 —
 * "Capa 1 — Pre-write detection" mentions a warning + log path for
 * `high_entropy_blob` matches).
 *
 * One event per finding: a payload containing N regex hits emits N
 * events. This makes downstream consumers' fan-out trivial (one event
 * → one audit row, one telemetry sample, ...).
 *
 * Invariants:
 * - `workspaceId` is the workspace the scan ran in. Cross-workspace
 *   correlation uses this field plus `occurredAt`.
 * - `finding` is the immutable VO emitted by the scanner.
 * - `eventName` is the stable `"secrets.detected"` identifier (per the
 *   shared `DomainEvent` contract: `<module>.<event-name-in-past-
 *   tense-kebab-case>`).
 */
export class SecretDetected implements DomainEvent {
  public readonly eventName = "secrets.detected" as const;
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
