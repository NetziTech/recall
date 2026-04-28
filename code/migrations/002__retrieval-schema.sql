-- ─────────────────────────────────────────────────────────────────────
-- 002__retrieval-schema.sql
--
-- Schema for the asynchronous embedding pipeline owned by the
-- `retrieval` module:
--
--   - `embedding_queue`     pending-job table
--                           (`docs/03-modelo-datos.md` §4.10)
--   - `embeddings`          vec0 virtual table
--                           (`docs/03-modelo-datos.md` §5)
--   - `embedding_metadata`  side table tying vec rows to their source
--                           memory row + model name + embedded text
--
-- Owner: `retrieval-expert` (Tarea 3.3 deliverable).
-- Consumers: this module's `EmbeddingQueueRepository`,
-- `MemoryProjectionRepository.loadProjectionsByHits`, and the
-- async `AsyncEmbeddingWorker`. The memory module's `record_*`
-- use cases enqueue items here as a side-effect of writes.
--
-- Idempotency: every CREATE uses IF NOT EXISTS so the migration
-- runner can re-run safely.
--
-- Cross-table coupling note: the FTS5 virtual tables for the
-- searchable memory kinds (`turns_fts`, `decisions_fts`,
-- `learnings_fts`, `entities_fts`) are part of the memory module's
-- schema (`docs/03-modelo-datos.md` §4.2-§4.5) and live in their own
-- migration owned by the memory module — NOT here. The retrieval
-- module only owns the embedding pipeline.
--
-- vec0 dependency: this migration references the `vec0(...)` virtual
-- table from `sqlite-vec`. The extension is loaded by the
-- `SqliteDatabase` adapter at connection-open time (Tarea 2.2 —
-- `docs/06-stack-tecnico.md` §7); when the adapter degrades to "no
-- vector extension", the migration will fail loudly here. That is
-- intentional: a server without vector search is still useful (the
-- recall pipeline degrades to FTS5 only) but its retrieval data
-- model is incomplete and the operator should know.
-- ─────────────────────────────────────────────────────────────────────

-- Asynchronous embedding queue. Mirrors `docs/03-modelo-datos.md` §4.10
-- but extends the spec with two columns the worker needs:
--
--   - `workspace_id` — even though the per-project DB IS the workspace
--     (`docs/03-modelo-datos.md` §4.1), the column is carried for
--     symmetry with the rest of the audit trail and so a future
--     multi-workspace flavour does not require a schema migration.
--   - `target_kind` — the discriminator of the source memory kind.
--     Replaces the `table_name` slot of the spec (which would couple
--     the queue row to the persistence-layer table names — a leakage
--     this migration avoids).
--   - `last_error` — the most recent failure message, used by the
--     worker's exponential-backoff path.
CREATE TABLE IF NOT EXISTS embedding_queue (
    id              TEXT    PRIMARY KEY,
    workspace_id    TEXT    NOT NULL,
    target_kind     TEXT    NOT NULL CHECK (target_kind IN ('decision', 'learning', 'entity', 'task', 'turn')),
    target_row_id   TEXT    NOT NULL,
    enqueued_at_ms  INTEGER NOT NULL,
    attempts        INTEGER NOT NULL DEFAULT 0,
    last_error      TEXT
);

-- The dequeue path filters by `(workspace_id, enqueued_at_ms)` and
-- breaks ties on the queue row id. The composite index covers both
-- the filter and the ordering; the second index supports
-- `recordFailure(...)` round trips.
CREATE INDEX IF NOT EXISTS idx_embedding_queue_workspace_enqueued
    ON embedding_queue (workspace_id, enqueued_at_ms);

CREATE INDEX IF NOT EXISTS idx_embedding_queue_target
    ON embedding_queue (target_kind, target_row_id);

-- Vector index. The `vec0` virtual table from sqlite-vec stores the
-- raw `Float32` vectors and supports `vec_distance_cosine(...)` /
-- `MATCH` predicates (`docs/06-stack-tecnico.md` §7). The dimension
-- is pinned to 384 because the default fastembed model
-- (BGE-Small-EN-1.5) produces 384-d vectors per `docs/06-stack-
-- tecnico.md` §6. A future `re-key`-shaped migration would either
-- (a) tear this table down and rebuild it with the new dimension,
-- or (b) add a parallel `embeddings_768` table. Per
-- `docs/03-modelo-datos.md` §5 the vector store is REGENERABLE from
-- `memoria.db` + the embedder, so dropping and rebuilding is the
-- expected path.
CREATE VIRTUAL TABLE IF NOT EXISTS embeddings USING vec0(
    id  TEXT PRIMARY KEY,
    vec FLOAT[384]
);

-- Side table tying each vector to its source row and embedder.
-- `model_name` is part of the natural key so a re-embed under a new
-- model produces a NEW row rather than overwriting the old one (the
-- curator can then reconcile and prune the stale rows in a separate
-- pass).
CREATE TABLE IF NOT EXISTS embedding_metadata (
    id              TEXT    PRIMARY KEY,
    workspace_id    TEXT    NOT NULL,
    target_kind     TEXT    NOT NULL,
    target_row_id   TEXT    NOT NULL,
    embedded_text   TEXT    NOT NULL,
    model_name      TEXT    NOT NULL,
    dimension       INTEGER NOT NULL,
    created_at_ms   INTEGER NOT NULL,
    UNIQUE (target_kind, target_row_id, model_name)
);

CREATE INDEX IF NOT EXISTS idx_embedding_metadata_origin
    ON embedding_metadata (target_kind, target_row_id);

CREATE INDEX IF NOT EXISTS idx_embedding_metadata_workspace
    ON embedding_metadata (workspace_id);
