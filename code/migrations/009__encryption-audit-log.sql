-- ─────────────────────────────────────────────────────────────────────
-- 009__encryption-audit-log.sql
--
-- ADR-005 Q4 — encryption audit log. Append-only via triggers.
-- Spec: docs/12 §1.5.5 + HANDOFF §6.27 Phase-22.
--
-- Schema CONGELADO (Phase-22, 2026-05-12). DO NOT mutate columns
-- without a new ADR superseding ADR-005. Field semantics:
--   - `event_id`         : UUID v7 (16 bytes BLOB).
--   - `occurred_at_ms`   : epoch ms (matches the codebase convention
--                          for every `*_at_ms` timestamp,
--                          docs/03-modelo-datos.md §2).
--   - `event_type`       : one of the 12 stricto enums documented in
--                          `EncryptionAuditEventType` (the domain
--                          discriminated union is the single source
--                          of truth; the column lacks a CHECK only
--                          because SQLite cannot keep it in sync with
--                          the domain type without a manual mirror —
--                          the application layer guarantees the value
--                          before INSERT).
--   - `envelope_id`      : nullable; events like `RekeyStarted` have no
--                          envelope yet, `UnlockFailed` may have none
--                          when no envelope matches.
--   - `master_key_fp`    : SHA-256(master)[:8 bytes] = 16 hex chars
--                          lowercase. Local-only correlation key
--                          (NEVER serialise outside this table).
--   - `actor_hint`       : human-readable origin
--                          (e.g. "cli:add-key", "mcp:unlock").
--   - `outcome`          : SUCCESS | FAILURE | TIMEOUT (stricto enum).
--   - `detail_json`      : metadata WITHOUT secrets
--                          (kdf_duration_ms, etc.).
--
-- Append-only enforcement:
--   - The two triggers below RAISE(ABORT) on any UPDATE or DELETE
--     attempt against the table. Persistence-side garbage collection
--     (rolling retention windows under ADR-005) MUST happen via a
--     dedicated migration that drops + recreates the table inside a
--     transaction; in-place mutation of historical rows is a contract
--     violation.
--   - There is NO `IF NOT EXISTS` on the triggers because the
--     migrations runner only applies each migration once and trigger
--     re-creation conflicts would be a real bug.
--
-- Idempotence:
--   - The runner (`shared/infrastructure/database/migrations-runner.ts`)
--     skips this migration after the first successful apply via
--     `schema_migrations`. The CREATE TABLE uses IF NOT EXISTS so
--     re-running against a database where the table already exists
--     (e.g. when restoring a partially-migrated workspace) is safe.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS encryption_audit_log (
    event_id         BLOB    PRIMARY KEY,   -- UUID v7 16 bytes
    occurred_at_ms   INTEGER NOT NULL,
    event_type       TEXT    NOT NULL,      -- stricto enum, see header
    envelope_id      TEXT,                  -- nullable (e.g. RekeyStarted)
    master_key_fp    TEXT,                  -- SHA-256(master)[:8 bytes] = 16 hex chars
    actor_hint       TEXT,                  -- "cli:add-key", "mcp:unlock"
    outcome          TEXT    NOT NULL,      -- SUCCESS | FAILURE | TIMEOUT
    detail_json      TEXT                   -- metadata without secrets
);

CREATE INDEX IF NOT EXISTS idx_eal_ts
    ON encryption_audit_log (occurred_at_ms DESC);

CREATE TRIGGER eal_no_update
BEFORE UPDATE ON encryption_audit_log
BEGIN
    SELECT RAISE(ABORT, 'audit log is append-only');
END;

CREATE TRIGGER eal_no_delete
BEFORE DELETE ON encryption_audit_log
BEGIN
    SELECT RAISE(ABORT, 'audit log is append-only');
END;
