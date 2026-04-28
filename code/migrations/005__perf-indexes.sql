-- ─────────────────────────────────────────────────────────────────────
-- 005__perf-indexes.sql
--
-- Performance indexes that complement the core schema in
-- `004__core-memory-schema.sql`. These were surfaced as H3/H4/H5 by
-- the Phase 4 — Task 4.5 performance auditor:
--
--   H3  tasks: WHERE status = ? ORDER BY created_at_ms DESC
--             — the existing `idx_tasks_status_priority(status,
--             priority)` covers the WHERE but not the ORDER BY, so
--             the planner falls back to SEARCH+SORT on workspaces
--             with thousands of tasks.
--   H4  entities: ORDER BY created_at_ms DESC across workspace-wide
--             reads. `idx_entities_name` and `idx_entities_kind`
--             cover the per-name / per-kind paths but not the
--             ordering, so global reads degenerate to SCAN+SORT.
--   H5  relations: WHERE from_entity_id = ? ORDER BY created_at_ms
--             DESC — `idx_relations_from` and `idx_relations_to`
--             cover the WHERE; on hub-style entities with many
--             outgoing edges the ORDER BY pays an extra sort.
--
-- Why a separate migration (instead of editing 004 in place):
--   - Migration 004 may already be applied in the wild; appending
--     to its body would not re-run on existing databases. A new
--     numbered migration is the only correct way to add indexes
--     post-release.
--   - Idempotency is preserved via `IF NOT EXISTS`.
--
-- Owner: `memory-domain` (same as 004).
-- ─────────────────────────────────────────────────────────────────────


-- ── H3. tasks: cover the (status filter + created_at ordering) path ──
CREATE INDEX IF NOT EXISTS idx_tasks_created_at
    ON tasks (created_at_ms DESC);


-- ── H4. entities: workspace-wide chronological reads ─────────────────
CREATE INDEX IF NOT EXISTS idx_entities_created_at
    ON entities (created_at_ms DESC);


-- ── H5. relations: chronological tie-breaker for endpoint scans ──────
CREATE INDEX IF NOT EXISTS idx_relations_created_at
    ON relations (created_at_ms DESC);
