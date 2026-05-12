import type {
  DatabaseConnection,
  PreparedStatement,
} from "../../../../shared/application/ports/database-connection.port.ts";
import type {
  EncryptionAuditEvent,
  EncryptionAuditLogRepository,
} from "../../domain/repositories/encryption-audit-log-repository.ts";

/**
 * Length, in bytes, of an `event_id` BLOB. UUID v7 is a 128-bit
 * identifier, hence exactly 16 bytes.
 */
const EVENT_ID_LENGTH_BYTES = 16;

/**
 * Number of canonical UUID hex digits (excludes the four dashes).
 * Used by the encoder to sanity-check the input string before
 * decoding.
 */
const UUID_HEX_LENGTH = EVENT_ID_LENGTH_BYTES * 2;

/**
 * SQL DDL for the audit-log table.
 *
 * The migration that ships this schema is
 * `code/migrations/009__encryption-audit-log.sql`. The DDL constant
 * lives below in JSDoc form for code review:
 *
 * ```sql
 * CREATE TABLE encryption_audit_log (
 *     event_id         BLOB    PRIMARY KEY,
 *     occurred_at_ms   INTEGER NOT NULL,
 *     event_type       TEXT    NOT NULL,
 *     envelope_id      TEXT,
 *     master_key_fp    TEXT,
 *     actor_hint       TEXT,
 *     outcome          TEXT    NOT NULL,
 *     detail_json      TEXT
 * );
 * CREATE INDEX idx_eal_ts ON encryption_audit_log (occurred_at_ms DESC);
 * CREATE TRIGGER eal_no_update BEFORE UPDATE ON encryption_audit_log
 *   BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;
 * CREATE TRIGGER eal_no_delete BEFORE DELETE ON encryption_audit_log
 *   BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;
 * ```
 */

const SQL_INSERT = `
INSERT INTO encryption_audit_log (
    event_id,
    occurred_at_ms,
    event_type,
    envelope_id,
    master_key_fp,
    actor_hint,
    outcome,
    detail_json
) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`.trim();

/**
 * Adapter that fulfils the `EncryptionAuditLogRepository` domain port
 * using the SQLite `encryption_audit_log` table (migration 009).
 *
 * **Source-of-truth: ADR-005 Q4 (Phase-22, docs/12 §1.5.5 appendix).**
 *
 * Persistence shape:
 * - One row per `EncryptionAuditEvent`. The `event_id` is encoded as
 *   a 16-byte BLOB (the canonical UUID v7 string is parsed into raw
 *   bytes by `SqliteEncryptionAuditRepository.uuidStringToBytes`).
 * - `occurred_at_ms` is the millisecond epoch integer.
 * - `event_type` is one of the 12 frozen `EncryptionAuditEventType`
 *   strings — persisted verbatim.
 * - `envelope_id` is the canonical UUID v7 string of the affected
 *   envelope, or SQL NULL.
 * - `master_key_fp` is the 16-character lowercase hex fingerprint
 *   (see `MasterKeyFingerprint`), or SQL NULL.
 * - `actor_hint` is the canonical trimmed `NonEmptyString` value.
 * - `outcome` is `SUCCESS | FAILURE | TIMEOUT` verbatim.
 * - `detail_json` is `JSON.stringify(event.detailJson)` or SQL NULL
 *   when the input field is null.
 *
 * Invariants:
 * - **Append-only enforcement happens at the SQLite layer**. The
 *   migration installs `eal_no_update` and `eal_no_delete` triggers
 *   that RAISE(ABORT) with the canonical error message
 *   `"audit log is append-only"`. The adapter therefore does NOT
 *   expose `delete` or `update` methods (and never will).
 * - The `master_key_fingerprint` field is local-only. Callers MUST
 *   NOT be given a public read API that returns the fingerprint
 *   back. Any future method intended to read audit rows (for an
 *   `mem.audit` flow, a forensic export, etc.) MUST redact the
 *   fingerprint or document a JSDoc constraint that callers cannot
 *   use the returned value outside the audit subsystem. Code review
 *   enforces this rule.
 *
 * Why no `findBy*`, no `count`, no `iterate`:
 * - This adapter is **strictly write-only by design**. ADR-005 Q4
 *   ships the read path to a dedicated `recall audit` CLI command
 *   that opens its own forensic SQLite handle; the running server
 *   never reads the audit log back, so the port stays minimal.
 *   Removing the temptation of an in-process read API also keeps
 *   the master-key-fingerprint procedural barrier intact.
 *
 * Prepared statement caching:
 * - The adapter caches the `INSERT` statement on construction. The
 *   `DatabaseConnection` port allows implementations to cache, but
 *   the cache is per-statement-string; pinning the prepared object
 *   on `this` removes the lookup cost from the hot path
 *   (docs/12 §1 perf).
 */
export class SqliteEncryptionAuditRepository
  implements EncryptionAuditLogRepository
{
  // Lazy-initialised prepared statement. Caching the lookup avoids
  // touching the database during construction — critical because
  // `recall init` wires the entire container with an
  // `UnavailableDatabaseConnection` stub (per
  // `bootstrap/composition-root.ts`), and an eager `db.prepare()` in
  // the constructor would throw `DatabaseUnavailableError` and abort
  // the bootstrap before `init` has a chance to bootstrap the DB.
  private cachedInsertStmt: PreparedStatement | null = null;

  public constructor(private readonly db: DatabaseConnection) {}

  /**
   * Appends one event to `encryption_audit_log`.
   *
   * Buffer ownership: `event_id` is parsed into a fresh
   * `Uint8Array` of length 16; the better-sqlite3 driver copies
   * the contents into the SQLCipher BLOB slot during `run`, so the
   * adapter does not retain a reference past the call.
   */
  // Async signature mantiene compatibilidad con el puerto (Promise<void>)
  // y preserva la semantica de rejection cuando uuidStringToBytes lanza.
  // require-await se desactiva localmente: better-sqlite3 es sync; no hay
  // await real pero la firma debe ser Promise<void> por contrato.
  // eslint-disable-next-line @typescript-eslint/require-await
  public async append(event: EncryptionAuditEvent): Promise<void> {
    const eventIdBytes = SqliteEncryptionAuditRepository.uuidStringToBytes(
      event.eventId.toString(),
    );
    const eventIdBuffer = Buffer.from(
      eventIdBytes.buffer,
      eventIdBytes.byteOffset,
      eventIdBytes.byteLength,
    );

    const envelopeIdSql: string | null =
      event.envelopeId === null ? null : event.envelopeId.toString();
    const masterKeyFpSql: string | null =
      event.masterKeyFingerprint === null
        ? null
        : event.masterKeyFingerprint.toHex();
    const actorHintSql: string = event.actorHint.toString();
    const detailJsonSql: string | null =
      event.detailJson === null ? null : JSON.stringify(event.detailJson);

    this.getInsertStmt().run(
      eventIdBuffer,
      event.occurredAt.epochMs,
      event.eventType,
      envelopeIdSql,
      masterKeyFpSql,
      actorHintSql,
      event.outcome,
      detailJsonSql,
    );
  }

  // -- internals --------------------------------------------------------

  /**
   * Returns the cached prepared INSERT, preparing it on first use.
   * Lazy initialisation avoids touching the database during
   * construction so the adapter survives being wired against an
   * `UnavailableDatabaseConnection` stub (the `recall init` path).
   */
  private getInsertStmt(): PreparedStatement {
    this.cachedInsertStmt ??= this.db.prepare(SQL_INSERT);
    return this.cachedInsertStmt;
  }

  /**
   * Parses a canonical UUID v7 string
   * (`xxxxxxxx-xxxx-7xxx-[8|9|a|b]xxx-xxxxxxxxxxxx`) into the
   * underlying 16-byte representation expected by the `event_id`
   * BLOB column.
   *
   * The `EventId` value object has already validated the shape at
   * the domain boundary, so this helper trusts the input is canonical
   * (lowercase hex with dashes in the right positions). It still
   * defends against malformed input — a defence-in-depth check that
   * pays for itself if a future caller bypasses the VO and binds a
   * raw string to the repository.
   */
  private static uuidStringToBytes(uuid: string): Uint8Array {
    const hex = uuid.replaceAll("-", "");
    if (hex.length !== UUID_HEX_LENGTH) {
      throw new Error(
        `event_id must canonically be a UUID v7 (32 hex digits after stripping dashes; got: ${String(hex.length)})`,
      );
    }
    const bytes = new Uint8Array(EVENT_ID_LENGTH_BYTES);
    for (let i = 0; i < EVENT_ID_LENGTH_BYTES; i += 1) {
      const start = i * 2;
      const slice = hex.slice(start, start + 2);
      const value = Number.parseInt(slice, 16);
      if (!Number.isFinite(value) || value < 0 || value > 0xff) {
        throw new Error(
          `event_id contains a non-hex byte at offset ${String(start)} ("${slice}")`,
        );
      }
      bytes[i] = value;
    }
    return bytes;
  }
}
