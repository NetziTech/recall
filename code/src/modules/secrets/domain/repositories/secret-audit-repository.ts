import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { SecretAuditEntry } from "../aggregates/secret-audit-entry.ts";
import type { AuditEventId } from "../value-objects/audit-event-id.ts";

/**
 * Driven port (output port) for persisting and reloading the
 * `SecretAuditEntry` aggregate.
 *
 * Implementations live in `infrastructure/persistence/` and translate
 * between the in-memory aggregate and the `audit_log` table documented
 * in `docs/03-modelo-datos.md` §4.8 (with the workspace-id projection
 * caveat noted on the aggregate).
 *
 * Contract:
 * - The repository works with the **whole aggregate**. Adapters MUST
 *   NOT expose partial-update methods or expose internal fields. The
 *   audit trail is append-only: there are NO `update` or `delete`
 *   methods on this interface — adding them would betray the
 *   `docs/11-seguridad-modos.md` §6 promise that the audit trail is a
 *   tamper-evident log.
 * - `findById` returns `null` (not a thrown error) when the entry does
 *   not exist. Callers decide whether absence is recoverable.
 * - `save` is responsible for writing the entry atomically; partial
 *   writes are a contract violation.
 * - Events buffered in the aggregate are NOT consumed by the
 *   repository. The application layer drains them via
 *   `pullEvents()` after `save` succeeds and dispatches them to
 *   subscribers.
 *
 * Query methods are named after business intent (`findByWorkspace`)
 * rather than SQL predicates so the application layer cannot drift
 * into ad-hoc filtering.
 */
export interface SecretAuditRepository {
  /**
   * Loads the audit entry identified by `id` from persistence. Returns
   * `null` if it does not exist.
   */
  findById(id: AuditEventId): Promise<SecretAuditEntry | null>;

  /**
   * Persists the audit entry. Implementations are free to perform an
   * upsert (the aggregate carries its own identity) but MUST be
   * atomic. Adapters that target `audit_log` typically use a single
   * INSERT statement.
   */
  save(entry: SecretAuditEntry): Promise<void>;

  /**
   * Returns the most recent `limit` audit entries that belong to
   * `workspaceId`, ordered by `occurredAt` descending.
   *
   * `limit` MUST be a positive finite integer; adapters reject zero
   * and negative values to refuse degenerate queries that would scan
   * the full table without returning anything useful. The caller
   * controls pagination (no cursor token: the rolling 90-day retention
   * policy keeps the result set small).
   */
  findByWorkspace(
    workspaceId: WorkspaceId,
    limit: number,
  ): Promise<readonly SecretAuditEntry[]>;
}
