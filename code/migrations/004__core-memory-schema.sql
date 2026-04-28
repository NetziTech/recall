-- ─────────────────────────────────────────────────────────────────────
-- 004__core-memory-schema.sql
--
-- Core schema for the `memory` bounded context. Materialises the
-- on-disk representation documented in `docs/03-modelo-datos.md` §4 of
-- the seven aggregates the memory module owns:
--
--   §4.1  sessions                  conversation rollups
--   §4.2  turns + turns_fts         per-turn rollups
--   §4.3  decisions + decisions_fts architectural decisions
--   §4.4  learnings + learnings_fts learnings catalog
--   §4.5  entities + entities_fts   software entities
--   §4.6  relations                 graph between entities
--   §4.7  tasks                     persistent task list
--
-- Owner: `memory-domain` (reused by retrieval/curator via the cross-
-- module ADR-001 carve-out: those modules query against the memory
-- aggregates' projections, but the DDL lives here).
--
-- Coordination with sibling migrations:
--   000__bootstrap.sql              defines `_meta(key, value)`
--   001__secret-audit-log.sql       defines `secret_audit_log`
--   002__retrieval-schema.sql       defines `embedding_queue`,
--                                   `embeddings` (vec0), `embedding_metadata`
--   003__pruned-and-curator-runs.sql defines `pruned`, `curator_runs`
--
-- This migration owns ONLY the core memory aggregates plus their FTS5
-- shadows. It does NOT redefine any sibling-owned table.
--
-- Foreign keys: per `docs/03-modelo-datos.md` §4 only `turns ->
-- sessions` and `relations -> entities` carry SQL-level FKs. The
-- "logical FK" between the embedding pipeline (sibling migration 002)
-- and the memory rows is intentionally enforced at the application
-- layer to keep modules decoupled (see comment in 002).
--
-- Idempotency: every CREATE uses IF NOT EXISTS so the migration runner
-- can re-run safely. Triggers also use IF NOT EXISTS (supported by
-- SQLite >= 3.30, which is the minimum requirement of better-sqlite3-
-- multiple-ciphers 12.x).
--
-- Indexes: scoped to the read paths actually used by the recall
-- pipeline (`docs/03 §4.*` indexes) plus the curator's hot queries
-- (already validated in `phase-3-task-3-*` and `phase-3-task-4-*`
-- reports). Anything broader is left out so the page cache covers the
-- working set.
-- ─────────────────────────────────────────────────────────────────────


-- ── 1. sessions ──────────────────────────────────────────────────────
-- `docs/03-modelo-datos.md` §4.1
CREATE TABLE IF NOT EXISTS sessions (
    id              TEXT    PRIMARY KEY,
    started_at_ms   INTEGER NOT NULL,
    ended_at_ms     INTEGER,
    intent          TEXT,
    summary         TEXT,
    next_seed       TEXT,
    resumed_from    TEXT,
    turns_count     INTEGER NOT NULL DEFAULT 0,
    metadata_json   TEXT    NOT NULL DEFAULT '{}'
);

-- Recall + audit: most-recent-first listings.
CREATE INDEX IF NOT EXISTS idx_sessions_started
    ON sessions (started_at_ms DESC);

-- Active-session lookup (still open) used by implicit-session detection
-- (`docs/01-arquitectura.md` §2.5). Partial index keeps it tiny.
CREATE INDEX IF NOT EXISTS idx_sessions_active
    ON sessions (ended_at_ms)
    WHERE ended_at_ms IS NULL;


-- ── 2. turns ─────────────────────────────────────────────────────────
-- `docs/03-modelo-datos.md` §4.2
CREATE TABLE IF NOT EXISTS turns (
    id                  TEXT    PRIMARY KEY,
    session_id          TEXT    NOT NULL,
    recorded_at_ms      INTEGER NOT NULL,
    summary             TEXT    NOT NULL,
    intent              TEXT,
    outcome             TEXT,
    files_touched_json  TEXT    NOT NULL DEFAULT '[]',
    decisions_json      TEXT    NOT NULL DEFAULT '[]',
    learnings_json      TEXT    NOT NULL DEFAULT '[]',
    tags_json           TEXT    NOT NULL DEFAULT '[]',
    confidence          REAL    NOT NULL DEFAULT 1.0,
    last_used_ms        INTEGER NOT NULL,
    use_count           INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_turns_recent
    ON turns (recorded_at_ms DESC);

CREATE INDEX IF NOT EXISTS idx_turns_session
    ON turns (session_id);

-- FTS5 lexical shadow. `content='turns'` is an external-content table
-- (the FTS table does NOT duplicate the row data; it indexes pointers
-- into `turns`). The triggers below keep the shadow in sync.
CREATE VIRTUAL TABLE IF NOT EXISTS turns_fts USING fts5(
    id      UNINDEXED,
    summary,
    intent,
    outcome,
    content='turns'
);

CREATE TRIGGER IF NOT EXISTS turns_ai AFTER INSERT ON turns BEGIN
    INSERT INTO turns_fts (id, summary, intent, outcome)
    VALUES (new.id, new.summary, new.intent, new.outcome);
END;

CREATE TRIGGER IF NOT EXISTS turns_ad AFTER DELETE ON turns BEGIN
    DELETE FROM turns_fts WHERE id = old.id;
END;

CREATE TRIGGER IF NOT EXISTS turns_au AFTER UPDATE ON turns BEGIN
    UPDATE turns_fts
        SET summary = new.summary,
            intent  = new.intent,
            outcome = new.outcome
        WHERE id = new.id;
END;


-- ── 3. decisions ─────────────────────────────────────────────────────
-- `docs/03-modelo-datos.md` §4.3
CREATE TABLE IF NOT EXISTS decisions (
    id                      TEXT    PRIMARY KEY,
    created_at_ms           INTEGER NOT NULL,
    title                   TEXT    NOT NULL,
    rationale               TEXT    NOT NULL,
    alternatives_rejected   TEXT    NOT NULL DEFAULT '[]',
    scope                   TEXT    NOT NULL DEFAULT 'project',
    module                  TEXT,
    superseded_by           TEXT,
    confidence              REAL    NOT NULL DEFAULT 1.0,
    last_used_ms            INTEGER NOT NULL,
    use_count               INTEGER NOT NULL DEFAULT 0,
    tags_json               TEXT    NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_decisions_created
    ON decisions (created_at_ms DESC);

-- Active-decision recall: `WHERE superseded_by IS NULL` is the default
-- filter for `mem.recall` per §4.3 ("decisions con superseded_by IS NOT
-- NULL se excluyen ... salvo include_superseded: true"). Partial index
-- so the planner can use it without scanning superseded rows.
CREATE INDEX IF NOT EXISTS idx_decisions_active
    ON decisions (superseded_by)
    WHERE superseded_by IS NULL;

-- Scope/module narrowing for the project-vs-module recall axes.
CREATE INDEX IF NOT EXISTS idx_decisions_scope
    ON decisions (scope, module);

CREATE VIRTUAL TABLE IF NOT EXISTS decisions_fts USING fts5(
    id      UNINDEXED,
    title,
    rationale,
    content='decisions'
);

CREATE TRIGGER IF NOT EXISTS decisions_ai AFTER INSERT ON decisions BEGIN
    INSERT INTO decisions_fts (id, title, rationale)
    VALUES (new.id, new.title, new.rationale);
END;

CREATE TRIGGER IF NOT EXISTS decisions_ad AFTER DELETE ON decisions BEGIN
    DELETE FROM decisions_fts WHERE id = old.id;
END;

CREATE TRIGGER IF NOT EXISTS decisions_au AFTER UPDATE ON decisions BEGIN
    UPDATE decisions_fts
        SET title     = new.title,
            rationale = new.rationale
        WHERE id = new.id;
END;


-- ── 4. learnings ─────────────────────────────────────────────────────
-- `docs/03-modelo-datos.md` §4.4
CREATE TABLE IF NOT EXISTS learnings (
    id                  TEXT    PRIMARY KEY,
    created_at_ms       INTEGER NOT NULL,
    content             TEXT    NOT NULL,
    trigger             TEXT,
    scope               TEXT    NOT NULL DEFAULT 'project',
    module              TEXT,
    severity            TEXT    NOT NULL DEFAULT 'tip',
    confidence          REAL    NOT NULL DEFAULT 1.0,
    last_used_ms        INTEGER NOT NULL,
    use_count           INTEGER NOT NULL DEFAULT 0,
    tags_json           TEXT    NOT NULL DEFAULT '[]',
    consolidated_into   TEXT
);

CREATE INDEX IF NOT EXISTS idx_learnings_created
    ON learnings (created_at_ms DESC);

CREATE INDEX IF NOT EXISTS idx_learnings_severity
    ON learnings (severity);

-- Active-learning recall: the curator consolidation flow drops the
-- old learning's row by setting `consolidated_into = <new_id>`; the
-- partial index keeps the live set small.
CREATE INDEX IF NOT EXISTS idx_learnings_active
    ON learnings (consolidated_into)
    WHERE consolidated_into IS NULL;

CREATE VIRTUAL TABLE IF NOT EXISTS learnings_fts USING fts5(
    id      UNINDEXED,
    content,
    trigger,
    content='learnings'
);

CREATE TRIGGER IF NOT EXISTS learnings_ai AFTER INSERT ON learnings BEGIN
    INSERT INTO learnings_fts (id, content, trigger)
    VALUES (new.id, new.content, new.trigger);
END;

CREATE TRIGGER IF NOT EXISTS learnings_ad AFTER DELETE ON learnings BEGIN
    DELETE FROM learnings_fts WHERE id = old.id;
END;

CREATE TRIGGER IF NOT EXISTS learnings_au AFTER UPDATE ON learnings BEGIN
    UPDATE learnings_fts
        SET content = new.content,
            trigger = new.trigger
        WHERE id = new.id;
END;


-- ── 5. entities ──────────────────────────────────────────────────────
-- `docs/03-modelo-datos.md` §4.5
CREATE TABLE IF NOT EXISTS entities (
    id              TEXT    PRIMARY KEY,
    name            TEXT    NOT NULL,
    entity_kind     TEXT    NOT NULL,
    description     TEXT    NOT NULL,
    location        TEXT,
    created_at_ms   INTEGER NOT NULL,
    updated_at_ms   INTEGER NOT NULL,
    confidence      REAL    NOT NULL DEFAULT 1.0,
    last_used_ms    INTEGER NOT NULL,
    use_count       INTEGER NOT NULL DEFAULT 0,
    tags_json       TEXT    NOT NULL DEFAULT '[]',
    UNIQUE (name, entity_kind)
);

CREATE INDEX IF NOT EXISTS idx_entities_name
    ON entities (name);

CREATE INDEX IF NOT EXISTS idx_entities_kind
    ON entities (entity_kind);

CREATE VIRTUAL TABLE IF NOT EXISTS entities_fts USING fts5(
    id      UNINDEXED,
    name,
    description,
    content='entities'
);

CREATE TRIGGER IF NOT EXISTS entities_ai AFTER INSERT ON entities BEGIN
    INSERT INTO entities_fts (id, name, description)
    VALUES (new.id, new.name, new.description);
END;

CREATE TRIGGER IF NOT EXISTS entities_ad AFTER DELETE ON entities BEGIN
    DELETE FROM entities_fts WHERE id = old.id;
END;

CREATE TRIGGER IF NOT EXISTS entities_au AFTER UPDATE ON entities BEGIN
    UPDATE entities_fts
        SET name        = new.name,
            description = new.description
        WHERE id = new.id;
END;


-- ── 6. relations ─────────────────────────────────────────────────────
-- `docs/03-modelo-datos.md` §4.6
CREATE TABLE IF NOT EXISTS relations (
    id              TEXT    PRIMARY KEY,
    from_entity_id  TEXT    NOT NULL,
    to_entity_id    TEXT    NOT NULL,
    relation        TEXT    NOT NULL,
    created_at_ms   INTEGER NOT NULL,
    confidence      REAL    NOT NULL DEFAULT 1.0,
    FOREIGN KEY (from_entity_id) REFERENCES entities(id),
    FOREIGN KEY (to_entity_id)   REFERENCES entities(id),
    UNIQUE (from_entity_id, to_entity_id, relation)
);

CREATE INDEX IF NOT EXISTS idx_relations_from
    ON relations (from_entity_id);

CREATE INDEX IF NOT EXISTS idx_relations_to
    ON relations (to_entity_id);


-- ── 7. tasks ─────────────────────────────────────────────────────────
-- `docs/03-modelo-datos.md` §4.7
--
-- Note: `tasks_fts` is intentionally NOT created. Per §4.7 the catalog
-- only lists a `(status, priority)` composite index; tasks are
-- typically queried by lifecycle slot, not by free-text search. The
-- retrieval-expert validator confirmed this in the Fase 3 reports.
CREATE TABLE IF NOT EXISTS tasks (
    id              TEXT    PRIMARY KEY,
    title           TEXT    NOT NULL,
    description     TEXT,
    status          TEXT    NOT NULL DEFAULT 'pending',
    priority        TEXT    NOT NULL DEFAULT 'medium',
    created_at_ms   INTEGER NOT NULL,
    updated_at_ms   INTEGER NOT NULL,
    completed_at_ms INTEGER,
    blocked_by_json TEXT    NOT NULL DEFAULT '[]',
    notes_json      TEXT    NOT NULL DEFAULT '[]',
    tags_json       TEXT    NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_tasks_status_priority
    ON tasks (status, priority);
