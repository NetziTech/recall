-- ─────────────────────────────────────────────────────────────────────
-- 000__bootstrap.sql
--
-- Bootstrap migration. Establishes the `_meta` table that future
-- migrations and runtime audits can use as a key/value sidecar.
--
-- Why this is intentionally minimal:
-- - The full schema (sessions, turns, decisions, learnings, entities,
--   relations, tasks, audit_log, pruned, embedding_queue, curator_runs,
--   FTS5 virtuals + triggers) is documented in `docs/03-modelo-datos.md`
--   §4 but lives in a SEPARATE migration (`001__core-schema.sql`),
--   delivered by the next implementation tasks (Fase 3 module work).
-- - Splitting bootstrap from the core schema keeps this file
--   composable: a future sub-DB (e.g. `vectors.db` per
--   `docs/03 §1`) re-uses the same bootstrap and overlays its own
--   schema.
-- - Tests can run this migration in isolation to verify the runner's
--   bookkeeping path without touching the full schema.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE _meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

INSERT INTO _meta(key, value) VALUES ('schema_version', '0');
INSERT INTO _meta(key, value) VALUES ('bootstrap_at_iso', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
