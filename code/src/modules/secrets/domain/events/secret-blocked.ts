import type { DomainEvent } from "../../../../shared/domain/types/domain-event.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { SecretFinding } from "../value-objects/secret-finding.ts";

/**
 * Fact: a tool invocation was rejected because the secrets scanner
 * detected a hard-reject secret in the payload.
 *
 * Emitted by the application layer when a `record_*` (or any other
 * write-side) use case refuses to proceed because the input contains a
 * `SecretFinding` whose `kind.isHardReject()` is `true`. The
 * downstream JSON-RPC error is `-32105 SECRET_DETECTED` per
 * `docs/11-seguridad-modos.md` §6 / §8 — but the *event* lives in the
 * domain so the audit-log writer can persist a row even when the
 * transport never gets a response.
 *
 * Mutually exclusive with `SecretRedacted` for a given finding (see
 * the rationale on `SecretRedacted`).
 *
 * Invariants:
 * - `workspaceId` is the workspace the scan ran in.
 * - `finding` is the immutable VO emitted by the scanner.
 * - `eventName` is the stable `"secrets.blocked"` identifier.
 */
export class SecretBlocked implements DomainEvent {
  public readonly eventName = "secrets.blocked" as const;
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
