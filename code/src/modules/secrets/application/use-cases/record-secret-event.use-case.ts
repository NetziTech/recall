import type { Clock } from "../../../../shared/application/ports/clock.port.ts";
import type { IdGenerator } from "../../../../shared/application/ports/id-generator.port.ts";
import type { Logger } from "../../../../shared/application/ports/logger.port.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import { SecretAuditEntry } from "../../domain/aggregates/secret-audit-entry.ts";
import type { SecretAuditRepository } from "../../domain/repositories/secret-audit-repository.ts";
import { AuditEventId } from "../../domain/value-objects/audit-event-id.ts";
import type { SecretAction } from "../../domain/value-objects/secret-action.ts";
import type { SecretFinding } from "../../domain/value-objects/secret-finding.ts";
import type { RecordSecretEvent } from "../ports/in/record-secret-event.port.ts";

/**
 * Use case: record a `SecretAuditEntry` in the append-only audit
 * trail.
 *
 * Mints a fresh `AuditEventId`, builds the aggregate via
 * `SecretAuditEntry.record(...)` (which emits
 * `SecretAuditEntryRecorded`), and persists it via the
 * `SecretAuditRepository`. Returns the freshly built aggregate so
 * the caller can drain its events with `pullEvents()` if it
 * dispatches them to a downstream subscriber.
 *
 * Persistence note:
 * - The aggregate's events are NOT consumed by the repository (per
 *   the `SecretAuditRepository` JSDoc). The application layer is
 *   responsible for draining them; the use case returns the
 *   aggregate after `save()` so the caller can decide whether to
 *   surface them now or buffer them for batch dispatch.
 *
 * Security:
 * - Logs the event at info level with the workspace id, finding
 *   `kind` and `action.kind` (all public). NEVER logs the
 *   `position.evidence` field (already redacted by the domain VO,
 *   but defence in depth).
 */
export class RecordSecretEventUseCase implements RecordSecretEvent {
  public constructor(
    private readonly repository: SecretAuditRepository,
    private readonly idGenerator: IdGenerator,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  public async record(input: {
    workspaceId: WorkspaceId;
    finding: SecretFinding;
    action: SecretAction;
  }): Promise<SecretAuditEntry> {
    const auditEventId = AuditEventId.from(this.idGenerator.generateString());
    const occurredAt = this.clock.now();

    const entry = SecretAuditEntry.record({
      id: auditEventId,
      workspaceId: input.workspaceId,
      finding: input.finding,
      action: input.action,
      occurredAt,
    });

    await this.repository.save(entry);

    this.logger.info(
      {
        workspaceId: input.workspaceId.toString(),
        auditEventId: auditEventId.toString(),
        findingKind: input.finding.kind.toString(),
        action: input.action.kind,
      },
      "secret audit entry recorded",
    );

    return entry;
  }
}
