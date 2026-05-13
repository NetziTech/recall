import type { DatabaseConnection } from "../../../../shared/application/ports/database-connection.port.ts";
import type { EncryptionAuditProbe } from "../../../../shared/application/ports/encryption-audit-probe.port.ts";
import { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";

/**
 * Returns the most recent `ExportKeyEmitted` row with `outcome=SUCCESS`.
 * Ordered DESC on the `occurred_at_ms` index (`idx_eal_ts`) so the
 * lookup is O(log n) on the table.
 *
 * Why filtered on `outcome=SUCCESS`:
 * - `ExportKeyEmitted` rows are only emitted on success today; a
 *   future use case that records `FAILURE` outcomes for export
 *   attempts SHOULD use a distinct event-type. Filtering defensively
 *   keeps the probe's contract stable: it returns the moment a real
 *   `export-key` payload was rendered, not the moment one was
 *   attempted.
 */
const SQL_LAST_SUCCESSFUL_EXPORT = `
SELECT occurred_at_ms
FROM encryption_audit_log
WHERE event_type = 'ExportKeyEmitted'
  AND outcome    = 'SUCCESS'
ORDER BY occurred_at_ms DESC
LIMIT 1
`.trim();

/**
 * Adapter that fulfils the `EncryptionAuditProbe` port via the SQLite
 * `encryption_audit_log` table (migration 009).
 *
 * Closes follow-up tracked FU-A7-2 (HANDOFF §8): the `recall health`
 * CLI surfaces `last_export_at` so the user can detect an export
 * payload that did NOT originate from them — defense in depth against
 * an unauthorised terminal that ran `recall export-key`.
 *
 * Why this adapter is read-only:
 * - The append-only invariant of the audit log lives at the persistence
 *   layer (triggers `eal_no_update` / `eal_no_delete`). This probe
 *   issues only SELECT statements; the triggers do not apply.
 * - The probe deliberately does NOT join on `master_key_fp` or
 *   `envelope_id`. The only field it surfaces is `occurred_at_ms`,
 *   which is non-secret by construction (an opaque epoch integer).
 *
 * Why the adapter lives in `encryption/infrastructure/`:
 * - The SQL it issues is encryption-module-specific (it knows the
 *   table name and the `ExportKeyEmitted` event-type enum). The port
 *   it implements lives in `shared/` so the workspace use case can
 *   import it without crossing the modularity boundary.
 *
 * Concurrency:
 * - Better-sqlite3 is synchronous and serial per connection; this
 *   probe holds no shared mutable state. Safe to call from any
 *   request path that already owns the `DatabaseConnection`.
 */
export class SqliteEncryptionAuditProbe implements EncryptionAuditProbe {
  public constructor(private readonly db: DatabaseConnection) {}

  public lastExportAt(): Promise<Timestamp | null> {
    const stmt = this.db.prepare(SQL_LAST_SUCCESSFUL_EXPORT);
    const row = stmt.get() as { occurred_at_ms: number } | undefined;
    if (row === undefined) {
      return Promise.resolve(null);
    }
    return Promise.resolve(Timestamp.fromEpochMs(row.occurred_at_ms));
  }
}
