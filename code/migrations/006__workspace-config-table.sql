-- ─────────────────────────────────────────────────────────────────────
-- 006__workspace-config-table.sql
--
-- Adds the `workspace_config` table that the retrieval module's
-- `SqliteMemoryProjectionRepository.loadWorkspaceAnchor` reads to
-- assemble the `workspace_anchor` layer of `mem.context` (see
-- `docs/04-capas-contexto.md` §2.1 and the `WorkspaceAnchorPayload` VO
-- in `src/modules/retrieval/domain/value-objects/`).
--
-- Bug context (Tarea 5.2 integration tests pin):
--   The retrieval adapter executes
--     SELECT workspace_id, display_name, mode, metadata_json
--     FROM   workspace_config
--     WHERE  workspace_id = ?
--   but no migration created the table, so every `mem.context` invocation
--   crashed with `database.prepare-failed: no such table: workspace_config`.
--
-- Why a separate migration (instead of folding into 004):
--   - Migration 004 may already be applied in databases in the wild; a
--     post-release append never re-runs on those. The numbered
--     migration is the only correct path forward.
--   - Idempotency preserved via `IF NOT EXISTS`.
--
-- Schema ownership and cross-module coupling:
--   - The `workspace` module is the WRITER of this table (rows are
--     upserted by the workspace use cases that own the workspace
--     identity / display name / mode lifecycle: initialise, change
--     mode). The persistence adapter lives in
--     `src/modules/workspace/infrastructure/persistence/sqlite-workspace-projection-writer.ts`.
--   - The `retrieval` (and indirectly `memory`/`curator`) modules are
--     READERS — they query the table to materialise the workspace
--     anchor projection.
--   - This matches the same pattern established with `embedding_queue`
--     in migration 002: the schema is shared, the source code is not.
--     Cross-import remains forbidden by ADR-001 (`docs/12 §1.5.1`); the
--     contract between writer and readers is the column shape pinned
--     here.
--
-- Columns (mirror what `WorkspaceConfigRowSchema` in
-- `sqlite-memory-projection-repository.ts` parses, line 109-114):
--   - `workspace_id`   UUID v7 string, primary key. Also the FK target
--                      (logical, not enforced at SQL level — see the
--                      same decoupling rationale as in migration 004
--                      and 002).
--   - `display_name`   non-empty string mirroring
--                      `<root>/.recall/config.json#display_name`.
--   - `mode`           one of `shared | encrypted | private` — the
--                      retrieval reader normalises invalid labels by
--                      returning `null` instead of throwing, so this
--                      migration deliberately does NOT add a CHECK
--                      constraint.
--   - `created_at_ms`  epoch milliseconds at which the workspace was
--                      initialised. Used by future analytics paths.
--   - `updated_at_ms`  epoch milliseconds of the most recent upsert.
--                      Lets `mem.context` show "workspace last touched"
--                      without recomputing from session writes.
--   - `metadata_json`  free-form JSON envelope for the
--                      `WorkspaceAnchorPayload.metadata` flat record.
--                      Defaults to `'{}'` so the projection reader
--                      always receives a well-formed JSON string.
-- ─────────────────────────────────────────────────────────────────────


CREATE TABLE IF NOT EXISTS workspace_config (
    workspace_id   TEXT    PRIMARY KEY,
    display_name   TEXT    NOT NULL,
    mode           TEXT    NOT NULL,
    created_at_ms  INTEGER NOT NULL,
    updated_at_ms  INTEGER NOT NULL,
    metadata_json  TEXT    NOT NULL DEFAULT '{}'
);
