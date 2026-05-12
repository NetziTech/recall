import { Id, type IdValue } from "../../../../shared/domain/value-objects/id.ts";

/**
 * Brand marker for encryption-audit event identifiers. Lives at the
 * type level only.
 */
export type EventIdBrand = "encryption-audit-event";

/**
 * Identifier of a single `EncryptionAuditEvent` row.
 *
 * Mirrors the `event_id` PRIMARY KEY of `encryption_audit_log`
 * (ADR-005 Q4, docs/12 §1.5.5). The on-disk column is `BLOB` (UUID
 * v7 16 bytes), but the domain models the identity as the canonical
 * UUID v7 string — the persistence adapter
 * (`SqliteEncryptionAuditRepository`) is the single site that
 * converts between the two representations.
 *
 * Why UUID v7 (not autoincrement INTEGER, not random UUID v4):
 * - Sortable by time, which matches the
 *   `encryption_audit_log.occurred_at_ms` ordering invariant: rows
 *   sorted by `event_id` produce the same order as rows sorted by
 *   `occurred_at_ms` (modulo same-millisecond ties), so an audit
 *   replay can scan the table in a single forward pass without a
 *   compound index.
 * - Consistency with every other aggregate identity in the codebase
 *   (`WorkspaceId`, `DecisionId`, `LearningId`, `KeyId`, etc.),
 *   which lets shared infrastructure (logging, tracing) treat all
 *   ids uniformly.
 * - Stable across re-imports and migrations (no integer counters
 *   that would collide when merging two workspaces).
 *
 * Inherits the UUID v7 invariants from `Id<EventIdBrand>`; the
 * brand pins the type so the compiler refuses to mix it with
 * `WorkspaceId`, `KeyId`, `AuditEventId` (secrets module), etc.
 */
export class EventId extends Id<EventIdBrand> {
  /**
   * Builds an `EventId` from a raw string. Validates UUID v7 shape
   * via the inherited `normalize` helper.
   */
  public static from(raw: string): EventId {
    const normalised = Id.normalize(raw, "event_id");
    return new EventId(normalised as IdValue<EventIdBrand>);
  }
}
