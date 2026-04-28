import type { DomainEvent } from "../../../../shared/domain/types/domain-event.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import { SecretAuditEntryRecorded } from "../events/secret-audit-entry-recorded.ts";
import type { AuditEventId } from "../value-objects/audit-event-id.ts";
import type { SecretAction } from "../value-objects/secret-action.ts";
import type { SecretFinding } from "../value-objects/secret-finding.ts";

/**
 * Aggregate root for ONE entry of the secrets audit trail.
 *
 * A `SecretAuditEntry` is the in-memory projection of a row in the
 * `audit_log` table (`docs/03-modelo-datos.md` §4.8) restricted to
 * secret-detection events. It owns:
 *
 * - The audit identity (`AuditEventId`).
 * - The workspace the detection happened in (`WorkspaceId`).
 * - The verbatim `SecretFinding` the scanner emitted.
 * - The `SecretAction` the application layer took in response.
 * - The instant (`Timestamp`) the action occurred.
 *
 * It enforces:
 *
 * - Immutability: once recorded, an audit entry NEVER mutates. The
 *   audit trail is append-only (`docs/11-seguridad-modos.md` §6 —
 *   "Capa 5 — Auditoria on-demand"). A correction would be a NEW
 *   entry with a different finding/action, never an in-place edit.
 * - Idempotent emission of `SecretAuditEntryRecorded`: the factory
 *   buffers exactly one event; subsequent `pullEvents()` calls drain
 *   it.
 *
 * Invariants:
 * - All fields are required (no nullable slots): an audit entry without
 *   a finding or action would carry no information.
 * - The aggregate is built only via the `record(...)` factory or the
 *   `rehydrate(...)` factory; the constructor is private.
 *
 * Persistence note:
 * - The `audit_log` schema does NOT yet carry the `workspace_id`
 *   column (the table predates the multi-workspace concern). The
 *   persistence adapter is responsible for projecting this field
 *   into the schema until the table catches up — typically via the
 *   `args_summary` JSON blob. The domain models the field anyway
 *   because cross-workspace correlation is a documented requirement.
 */
export class SecretAuditEntry {
  private readonly id: AuditEventId;
  private readonly workspaceId: WorkspaceId;
  private readonly finding: SecretFinding;
  private readonly action: SecretAction;
  private readonly occurredAt: Timestamp;
  private readonly events: DomainEvent[];

  private constructor(input: {
    id: AuditEventId;
    workspaceId: WorkspaceId;
    finding: SecretFinding;
    action: SecretAction;
    occurredAt: Timestamp;
    events: readonly DomainEvent[];
  }) {
    this.id = input.id;
    this.workspaceId = input.workspaceId;
    this.finding = input.finding;
    this.action = input.action;
    this.occurredAt = input.occurredAt;
    // Defensive copy: the constructor accepts a `readonly` view but
    // owns a mutable buffer internally so `pullEvents()` can drain it.
    this.events = [...input.events];
  }

  // -- factories -----------------------------------------------------------

  /**
   * Records a brand-new audit entry. Use this exactly once per
   * detection-action pair, when the application layer has decided how
   * to react to the finding.
   *
   * Emits `SecretAuditEntryRecorded`.
   */
  public static record(input: {
    id: AuditEventId;
    workspaceId: WorkspaceId;
    finding: SecretFinding;
    action: SecretAction;
    occurredAt: Timestamp;
  }): SecretAuditEntry {
    const event = new SecretAuditEntryRecorded({
      auditEventId: input.id,
      workspaceId: input.workspaceId,
      finding: input.finding,
      action: input.action,
      occurredAt: input.occurredAt,
    });
    return new SecretAuditEntry({
      id: input.id,
      workspaceId: input.workspaceId,
      finding: input.finding,
      action: input.action,
      occurredAt: input.occurredAt,
      events: [event],
    });
  }

  /**
   * Rehydrates a `SecretAuditEntry` from previously-persisted state.
   * Does NOT emit any event (no business fact is happening: we are
   * just observing existing data).
   */
  public static rehydrate(input: {
    id: AuditEventId;
    workspaceId: WorkspaceId;
    finding: SecretFinding;
    action: SecretAction;
    occurredAt: Timestamp;
  }): SecretAuditEntry {
    return new SecretAuditEntry({
      id: input.id,
      workspaceId: input.workspaceId,
      finding: input.finding,
      action: input.action,
      occurredAt: input.occurredAt,
      events: [],
    });
  }

  // -- queries -------------------------------------------------------------

  public getId(): AuditEventId {
    return this.id;
  }

  public getWorkspaceId(): WorkspaceId {
    return this.workspaceId;
  }

  public getFinding(): SecretFinding {
    return this.finding;
  }

  public getAction(): SecretAction {
    return this.action;
  }

  public getOccurredAt(): Timestamp {
    return this.occurredAt;
  }

  /**
   * Drains and returns the buffered events. Mirrors the workspace and
   * memory aggregates' contracts: the application layer pulls events
   * after the repository write succeeds and dispatches them to
   * subscribers.
   */
  public pullEvents(): readonly DomainEvent[] {
    if (this.events.length === 0) return Object.freeze([]);
    const drained = this.events.slice();
    this.events.length = 0;
    return Object.freeze(drained);
  }
}
