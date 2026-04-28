-- ─────────────────────────────────────────────────────────────────────
-- 007__fts-trigger-column-scope.sql
--
-- Bug F (Tarea 5.4) regression fix — the curator's `ApplyDecay` pass
-- was timing out at ~170s for 50K decisions even after the SQLite
-- iterator/writer reentrancy fix landed. Profiling traced the
-- bottleneck to the per-table `*_au` triggers from
-- `004__core-memory-schema.sql`, which fire on EVERY UPDATE and
-- re-index the full FTS5 mirror — including when the only changed
-- column is `confidence` (the curator's hot path).
--
-- Why this is the only viable fix:
--   - SQLite's `UPDATE OF <col1>, <col2>` syntax restricts the
--     trigger to fire only when the listed columns change. Without
--     this scope, a `confidence` UPDATE pays the full FTS5
--     reindex cost (170s for 50K decisions on a modern laptop).
--     With the scope, the trigger is a no-op for `confidence`
--     UPDATEs and the same workspace runs in <1s.
--   - The original migration 004 cannot be edited in place; SQLite
--     does not support `CREATE OR REPLACE TRIGGER`. We DROP the
--     existing trigger and recreate it scoped to the FTS-mirrored
--     columns only.
--   - Idempotency: every `DROP TRIGGER IF EXISTS` is a no-op when
--     the trigger does not exist; every `CREATE TRIGGER` defines a
--     fresh handle.
--
-- Tables affected: `decisions`, `learnings`, `entities`, `turns`.
-- Tables NOT affected: `tasks` (no FTS5 mirror per
-- `004 §7`), `relations` (no FTS5 mirror), `sessions` (no FTS5
-- mirror), `pruned`/`curator_runs` (curator-owned, no triggers).
--
-- Owner: `memory-domain`.
-- ─────────────────────────────────────────────────────────────────────


-- ── decisions ────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS decisions_au;

CREATE TRIGGER decisions_au
AFTER UPDATE OF title, rationale ON decisions BEGIN
    UPDATE decisions_fts
        SET title     = new.title,
            rationale = new.rationale
        WHERE id = new.id;
END;


-- ── learnings ────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS learnings_au;

CREATE TRIGGER learnings_au
AFTER UPDATE OF content, trigger ON learnings BEGIN
    UPDATE learnings_fts
        SET content = new.content,
            trigger = new.trigger
        WHERE id = new.id;
END;


-- ── entities ─────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS entities_au;

CREATE TRIGGER entities_au
AFTER UPDATE OF name, description ON entities BEGIN
    UPDATE entities_fts
        SET name        = new.name,
            description = new.description
        WHERE id = new.id;
END;


-- ── turns ────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS turns_au;

CREATE TRIGGER turns_au
AFTER UPDATE OF summary, intent, outcome ON turns BEGIN
    UPDATE turns_fts
        SET summary = new.summary,
            intent  = new.intent,
            outcome = new.outcome
        WHERE id = new.id;
END;
