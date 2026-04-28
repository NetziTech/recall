-- ─────────────────────────────────────────────────────────────────────
-- 001__secret-audit-log.sql
--
-- Schema for the `secret_audit_log` table consumed by
-- `modules/secrets/infrastructure/persistence/sqlite-secret-audit-repository.ts`.
--
-- Owner: `crypto-security-expert` (Fase 3 deliverable for `modules/secrets/`).
-- Mirrors the persistence shape documented in
-- `docs/03-modelo-datos.md` §4.8 (`audit_log`) RESTRICTED TO secret-
-- detection events. The richer fields (kind, position, confidence,
-- source, detected_by) are JSON-encoded into `finding_json` so the
-- on-disk shape stays close to the in-memory `SecretFinding` VO
-- without multiplying the schema for fields the system never
-- queries on independently.
--
-- The audit trail is append-only (`docs/11-seguridad-modos.md` §6
-- "Capa 5 — Auditoria on-demand"). The DDL therefore does NOT
-- include any DELETE TRIGGER or CASCADE: persistence-side garbage
-- collection (rolling 90-day retention) is run by a separate
-- scheduled job that writes a single DELETE statement.
--
-- Idempotent: every CREATE uses IF NOT EXISTS so the migration
-- runner can re-run safely.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS secret_audit_log (
    id              TEXT    PRIMARY KEY,
    workspace_id    TEXT    NOT NULL,
    occurred_at_ms  INTEGER NOT NULL,
    action          TEXT    NOT NULL CHECK (action IN ('blocked', 'redacted', 'warned_user')),
    finding_json    TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_secret_audit_log_by_workspace
    ON secret_audit_log (workspace_id, occurred_at_ms DESC);
