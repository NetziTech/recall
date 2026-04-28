-- ─────────────────────────────────────────────────────────────────────
-- 003__pruned-and-curator-runs.sql
--
-- Schema for the two curator-owned tables:
--   1. `pruned`        — append-only audit trail of memory entries that
--                        the curator (or `mem.forget`) dropped from the
--                        live tables. Mirrors `docs/03-modelo-datos.md`
--                        §4.9 plus the curator-specific extensions:
--                        `kind` (so the pruned row can be routed back
--                        to the correct kind-specific repository
--                        without an extra join) and `workspace_id` for
--                        symmetry with the curator domain VOs.
--   2. `curator_runs`  — one row per `CuratorRun` aggregate. Mirrors
--                        the layout in `docs/03-modelo-datos.md` §4.11
--                        with the additional counters
--                        (`paths_corrected`, `embeddings_requeued`,
--                        `open_questions_aged`) the domain layer
--                        already tracks via `CuratorRunStats`. The
--                        `trigger` column comes from
--                        `CuratorRunTrigger` (`scheduled` | `manual` |
--                        `session_close`).
--
-- Owner: `curator-expert` (Fase 3 deliverable for `modules/curator/`).
--
-- The on-disk shapes were chosen to match the in-memory aggregates:
-- - The `pruned` table layout matches `PrunedEntry`
--   (`workspace_id`, `kind`, `original_id`, `content_snapshot`,
--   `reason`, `pruned_at_ms`).  Kind disambiguates id collisions
--   between aggregates that happen to share a UUID.
-- - The `curator_runs` table layout matches `CuratorRun` +
--   `CuratorRunStats`. `ended_at_ms` is nullable so an in-flight run
--   can be persisted before completion.
--
-- Idempotent: every CREATE uses IF NOT EXISTS so the migration
-- runner can re-run safely.
--
-- Performance:
-- - Both tables use a single composite/single-column index per access
--   pattern. The curator's recurring queries are
--   `SELECT … FROM curator_runs ORDER BY started_at_ms DESC LIMIT N`
--   (`recall curator-log`) and
--   `SELECT … FROM pruned WHERE kind = ? AND original_id = ?`
--   (audit-trail lookups), both of which the indexes below cover.
-- ─────────────────────────────────────────────────────────────────────

-- 1. Pruning audit trail
CREATE TABLE IF NOT EXISTS pruned (
    workspace_id      TEXT    NOT NULL,
    kind              TEXT    NOT NULL CHECK (kind IN ('decision', 'learning', 'entity', 'task', 'turn')),
    original_id       TEXT    NOT NULL,
    content_snapshot  TEXT    NOT NULL,
    reason            TEXT    NOT NULL CHECK (reason IN ('low_confidence', 'manual', 'consolidated_into_other', 'obsoleted')),
    pruned_at_ms      INTEGER NOT NULL,
    PRIMARY KEY (workspace_id, kind, original_id)
);

CREATE INDEX IF NOT EXISTS idx_pruned_by_workspace
    ON pruned (workspace_id, pruned_at_ms DESC);

CREATE INDEX IF NOT EXISTS idx_pruned_by_kind
    ON pruned (kind, pruned_at_ms DESC);

-- 2. Curator run lifecycle
CREATE TABLE IF NOT EXISTS curator_runs (
    id                       TEXT    PRIMARY KEY,
    workspace_id             TEXT    NOT NULL,
    trigger                  TEXT    NOT NULL CHECK (trigger IN ('scheduled', 'manual', 'session_close')),
    started_at_ms            INTEGER NOT NULL,
    ended_at_ms              INTEGER,
    entries_scanned          INTEGER NOT NULL DEFAULT 0,
    entries_decayed          INTEGER NOT NULL DEFAULT 0,
    entries_pruned           INTEGER NOT NULL DEFAULT 0,
    learnings_consolidated   INTEGER NOT NULL DEFAULT 0,
    paths_corrected          INTEGER NOT NULL DEFAULT 0,
    embeddings_requeued      INTEGER NOT NULL DEFAULT 0,
    open_questions_aged      INTEGER NOT NULL DEFAULT 0,
    duration_ms              INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_curator_runs_by_workspace
    ON curator_runs (workspace_id, started_at_ms DESC);

CREATE INDEX IF NOT EXISTS idx_curator_runs_inflight
    ON curator_runs (workspace_id, started_at_ms DESC)
    WHERE ended_at_ms IS NULL;
