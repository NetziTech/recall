-- ─────────────────────────────────────────────────────────────────────
-- 008__decisions-content.sql
--
-- Bug B-MCP-4 fix (issue #3, critical, data loss).
--
-- Background: the wire schema in `docs/02-protocolo-mcp.md §4.4`
-- documents `content: string` as the canonical full-text field for
-- every `mem.remember` kind. The `decisions` table created in
-- migration 004 had no `content` column, so the field was silently
-- dropped during persistence. Clients that supplied both
-- `content` and `rationale` lost the former without any error.
--
-- Decision: Option B from the ADR — preserve the documented wire
-- contract and add the column. Stability of the public protocol
-- outweighs the cost of a one-time schema migration on existing
-- workspaces.
--
-- This migration:
--   1. Adds `content TEXT NOT NULL DEFAULT ''` to the `decisions`
--      base table. The default keeps NOT NULL semantics tractable
--      for SQLite's restricted ALTER TABLE.
--   2. Backfills existing rows with `content = rationale`. We choose
--      `rationale` rather than the empty string because:
--        - rationale is the closest semantic neighbour and was the
--          best available substitute that the v0.1.0/v0.1.1 facade
--          actually persisted (`rationale: input.rationale ?? input.content`);
--        - empty content would defeat the recall path's preview/FTS
--          for every existing row, breaking searches against
--          dogfood data;
--        - the domain VO (`DecisionContent`) requires a non-empty
--          string; backfilling with rationale keeps rehydration
--          well-formed across the boundary.
--   3. Replaces the `decisions_fts` virtual table to include the
--      `content` column. FTS5 with external content (`content='decisions'`)
--      requires the FTS column names to match the base table; the
--      virtual table cannot be ALTERed in place, so we drop and
--      recreate.
--   4. Repopulates the new FTS index from the now-backfilled base
--      table.
--   5. Replaces the `decisions_ai`, `decisions_ad`, and `decisions_au`
--      triggers to keep the FTS mirror in sync with the new column.
--
-- Owner: `memory-domain` (aggregate change), `composition` (wiring).
-- Idempotency: SQLite's `ADD COLUMN` is one-shot, so this migration
-- relies on the migrations runner's `_meta`-based "applied versions"
-- bookkeeping. Re-running on an already-migrated workspace would
-- fail at step 1; the runner skips applied versions by design.
-- ─────────────────────────────────────────────────────────────────────


-- ── 1. base table column ─────────────────────────────────────────────
ALTER TABLE decisions ADD COLUMN content TEXT NOT NULL DEFAULT '';


-- ── 2. backfill ──────────────────────────────────────────────────────
-- Existing rows inherited from v0.1.x wire calls have `rationale` set
-- (it was the field the facade persisted). Copy it into the new
-- `content` slot so:
--   (a) `DecisionContent` rehydration succeeds for every row;
--   (b) FTS5 keeps producing hits for legacy rows after the index
--       rebuild below.
UPDATE decisions
   SET content = rationale
 WHERE content = '';


-- ── 3. drop the obsolete FTS5 virtual table ──────────────────────────
-- DROP TABLE on an FTS5 virtual table also removes the auxiliary
-- shadow tables (`decisions_fts_data`, `_idx`, `_docsize`,
-- `_config`).
DROP TABLE IF EXISTS decisions_fts;


-- ── 4. recreate with the `content` column added ──────────────────────
-- Mirrors `004 §3` plus the new column. `content='decisions'` keeps
-- the external-content layout — the FTS5 row is a search index over
-- the base row, no duplication on disk.
CREATE VIRTUAL TABLE decisions_fts USING fts5(
    id      UNINDEXED,
    title,
    rationale,
    content,
    content='decisions'
);


-- ── 5. rebuild the FTS index from the base table ─────────────────────
-- `INSERT INTO <fts5> SELECT ...` re-tokenises every base row.
INSERT INTO decisions_fts (id, title, rationale, content)
SELECT id, title, rationale, content FROM decisions;


-- ── 6. replace triggers ──────────────────────────────────────────────
DROP TRIGGER IF EXISTS decisions_ai;
DROP TRIGGER IF EXISTS decisions_ad;
DROP TRIGGER IF EXISTS decisions_au;

CREATE TRIGGER decisions_ai AFTER INSERT ON decisions BEGIN
    INSERT INTO decisions_fts (id, title, rationale, content)
    VALUES (new.id, new.title, new.rationale, new.content);
END;

CREATE TRIGGER decisions_ad AFTER DELETE ON decisions BEGIN
    DELETE FROM decisions_fts WHERE id = old.id;
END;

-- Migration 007's column-scoped UPDATE OF rule preserves the
-- "skip FTS when only confidence/use_count/last_used_ms changes"
-- optimisation; carrying it forward as we add `content` to the
-- watched-columns list.
CREATE TRIGGER decisions_au
AFTER UPDATE OF title, rationale, content ON decisions BEGIN
    UPDATE decisions_fts
        SET title     = new.title,
            rationale = new.rationale,
            content   = new.content
        WHERE id = new.id;
END;
