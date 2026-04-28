import type { WorkspaceId } from "../../../../../shared/domain/value-objects/workspace-id.ts";
import type { SecretAction } from "../../../domain/value-objects/secret-action.ts";
import type { SecretFinding } from "../../../domain/value-objects/secret-finding.ts";
import type { SecretAuditEntry } from "../../../domain/aggregates/secret-audit-entry.ts";

/**
 * Driving (input) port: record a `SecretAuditEntry` in the
 * append-only audit trail.
 *
 * Implements the "Capa 5 — Auditoria on-demand" persistence side and
 * the audit-log writes from "Capa 1 — Pre-write detection". The use
 * case mints a fresh `AuditEventId`, builds the aggregate via
 * `SecretAuditEntry.record(...)` (which emits
 * `SecretAuditEntryRecorded`), and persists it via the
 * `SecretAuditRepository`.
 *
 * The use case takes the `finding` and `action` as separate inputs
 * because the call site (`RecordDecisionUseCase`,
 * `InstallPreCommitHookUseCase`, ...) is the one that decides which
 * action to attach: only the application layer knows whether the
 * surrounding write was blocked, redacted or merely warned.
 */
export interface RecordSecretEvent {
  record(input: {
    workspaceId: WorkspaceId;
    finding: SecretFinding;
    action: SecretAction;
  }): Promise<SecretAuditEntry>;
}
