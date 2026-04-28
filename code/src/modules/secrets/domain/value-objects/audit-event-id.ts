import { Id, type IdValue } from "../../../../shared/domain/value-objects/id.ts";

/**
 * Brand marker for audit-event identifiers. Lives at the type level
 * only.
 */
export type AuditEventIdBrand = "audit-event";

/**
 * Identifier of a `SecretAuditEntry` aggregate.
 *
 * Backs the audit trail of secret detections (`docs/11-seguridad-modos.md`
 * §6 — "Capa 5 — Auditoria on-demand"). The on-disk representation in
 * `audit_log` (`docs/03-modelo-datos.md` §4.8) uses an INTEGER
 * autoincrement column today, but the domain models the identity as
 * UUID v7 for two reasons:
 *
 * - Consistency with every other aggregate in the codebase (Decision,
 *   Learning, Entity, Workspace) which uses UUID v7. A homogeneous
 *   identity model lets shared infrastructure (logging, tracing,
 *   dispatch) treat all aggregates uniformly.
 * - Sortability: UUID v7 is time-ordered, which matches the rolling
 *   90-day retention policy of `audit_log` without requiring a
 *   secondary index for chronological ordering.
 *
 * The persistence adapter is responsible for projecting this id onto
 * whatever shape the `audit_log` schema requires (currently:
 * supplementary column, eventually: replace the autoincrement
 * altogether). The schema decision is out of scope for the domain;
 * see the persistence-adapter documentation for the mapping rule.
 *
 * Inherits the UUID v7 invariants from `Id<AuditEventIdBrand>`; the
 * brand pins the type so the compiler refuses to mix it with
 * `WorkspaceId`, `DecisionId`, etc.
 */
export class AuditEventId extends Id<AuditEventIdBrand> {
  /**
   * Builds an `AuditEventId` from a raw string. Validates UUID v7
   * shape via the inherited `normalize` helper.
   */
  public static from(raw: string): AuditEventId {
    const normalised = Id.normalize(raw, "audit_event_id");
    return new AuditEventId(normalised as IdValue<AuditEventIdBrand>);
  }
}
