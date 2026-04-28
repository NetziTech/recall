# 03 — Modelo de datos

> Esquemas SQLite + FTS5 + indices vectoriales. Lo que vive en disco, donde,
> y como migra cuando se actualiza el MCP.

---

## 1. Estructura de archivos

### Por proyecto

```
<proyecto>/.recall/
├── recall.db                  # SQLite estructurado (con SQLCipher si modo encrypted)
├── vectors.db                  # SQLite con sqlite-vec (con SQLCipher si modo encrypted)
├── config.json                 # Config del workspace
├── .gitignore                  # auto-creado segun modo
└── snapshots/                  # backup automatico antes de operaciones destructivas
    ├── 2026-04-27-pre-curator.db
    └── 2026-04-27-pre-migration.db
```

### En HOME del usuario

```
~/.cache/recall/           # XDG_CACHE_HOME (cache, borrable)
├── models/
│   ├── bge-small-en-v1.5/      # 33 MB ONNX
│   └── multilingual-e5-base/   # 250 MB ONNX (si el usuario lo eligio)
└── logs/
    └── 2026-04-27.log

~/.config/recall/          # XDG_CONFIG_HOME (config + claves)
├── config.json                 # Defaults globales del usuario
└── keys/
    └── <workspace_id>.key      # Permisos 0600
```

---

## 2. `.recall/config.json`

Vive en el proyecto, se versiona en git en modos `shared` y `encrypted`.

```json
{
  "schema_version": "1.0.0",
  "workspace_id": "01952f3b-7d8c-7b4a-b4f1-a3f8d12e5c89",
  "display_name": "Coder",
  "mode": "shared",
  "created_at_ms": 1745000000000,
  "metadata": {
    "language": "rust",
    "phase": "1"
  },
  "embedder": {
    "model": "BGESmallEN15",
    "dimension": 384
  },
  "secrets": {
    "enabled": true,
    "extra_patterns": [],
    "allowed_patterns": [],
    "entropy_threshold": 4.5
  },
  "retrieval": {
    "default_top_k": 8,
    "default_max_tokens": 2000,
    "scoring": {
      "cosine_weight": 0.4,
      "bm25_weight": 0.2,
      "recency_weight": 0.2,
      "usage_weight": 0.15,
      "priority_weight": 0.05
    }
  },
  "curator": {
    "decay_factor": 0.95,
    "decay_period_days": 30,
    "consolidation_similarity_threshold": 0.92,
    "max_entries_per_kind": 5000,
    "auto_run_every_n_turns": 100
  }
}
```

### Campos especificos del modo `encrypted`

```json
{
  "mode": "encrypted",
  "kdf": "argon2id",
  "kdf_params": {
    "memory_kib": 65536,
    "iterations": 3,
    "parallelism": 4,
    "salt_b64": "rZk7Lq4WV8RTX9YBN2HCDFGJM1PSE4ULAabcd"
  },
  "key_validator_blob_b64": "<encrypted-known-string-base64>",
  "key_envelopes": [
    {
      "id": "envelope-1",
      "created_at_ms": 1745000000000,
      "ciphertext_b64": "<wrapped-master-key>"
    }
  ]
}
```

`key_envelopes` permite multi-key en v0.5+. En MVP es un solo envelope.

---

## 3. `~/.config/recall/config.json`

Defaults globales del usuario. Solo cosas que NO deben repetirse por proyecto:

```json
{
  "schema_version": "1.0.0",
  "embedder": {
    "provider": "fastembed",
    "model": "BGESmallEN15",
    "voyage_api_key_env_var": "VOYAGE_AI_KEY"
  },
  "logging": {
    "level": "info",
    "rotate_after_mb": 50
  },
  "auto_curator": true,
  "session_idle_timeout_min": 30
}
```

Si un proyecto define `embedder.model` distinto, ese gana.

---

## 4. SQLite: `recall.db`

### 4.1 Tabla `sessions`

```sql
CREATE TABLE sessions (
    id              TEXT PRIMARY KEY,
    started_at_ms   INTEGER NOT NULL,
    ended_at_ms     INTEGER,
    intent          TEXT,
    summary         TEXT,
    next_seed       TEXT,
    resumed_from    TEXT,
    turns_count     INTEGER NOT NULL DEFAULT 0,
    metadata_json   TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX idx_sessions_started ON sessions(started_at_ms DESC);
CREATE INDEX idx_sessions_active  ON sessions(ended_at_ms) WHERE ended_at_ms IS NULL;
```

Nota: no hay `workspace_id` porque toda la DB ES el workspace (memoria-en-proyecto).

### 4.2 Tabla `turns`

```sql
CREATE TABLE turns (
    id                  TEXT PRIMARY KEY,
    session_id          TEXT NOT NULL,
    recorded_at_ms      INTEGER NOT NULL,
    summary             TEXT NOT NULL,
    intent              TEXT,
    outcome             TEXT,
    files_touched_json  TEXT NOT NULL DEFAULT '[]',
    decisions_json      TEXT NOT NULL DEFAULT '[]',
    learnings_json      TEXT NOT NULL DEFAULT '[]',
    tags_json           TEXT NOT NULL DEFAULT '[]',
    confidence          REAL NOT NULL DEFAULT 1.0,
    last_used_ms        INTEGER NOT NULL,
    use_count           INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE INDEX idx_turns_recent  ON turns(recorded_at_ms DESC);
CREATE INDEX idx_turns_session ON turns(session_id);

-- FTS5 virtual para busqueda lexical
CREATE VIRTUAL TABLE turns_fts USING fts5(
    id UNINDEXED,
    summary,
    intent,
    outcome,
    content='turns'
);

-- Triggers para mantener FTS5 sincronizado
CREATE TRIGGER turns_ai AFTER INSERT ON turns BEGIN
    INSERT INTO turns_fts(id, summary, intent, outcome)
    VALUES (new.id, new.summary, new.intent, new.outcome);
END;
CREATE TRIGGER turns_ad AFTER DELETE ON turns BEGIN
    DELETE FROM turns_fts WHERE id = old.id;
END;
CREATE TRIGGER turns_au AFTER UPDATE ON turns BEGIN
    UPDATE turns_fts SET summary=new.summary, intent=new.intent, outcome=new.outcome
    WHERE id = new.id;
END;
```

### 4.3 Tabla `decisions`

```sql
CREATE TABLE decisions (
    id                      TEXT PRIMARY KEY,
    created_at_ms           INTEGER NOT NULL,
    title                   TEXT NOT NULL,
    rationale               TEXT NOT NULL,
    alternatives_rejected   TEXT NOT NULL DEFAULT '[]',
    scope                   TEXT NOT NULL DEFAULT 'project',
    module                  TEXT,
    superseded_by           TEXT,
    confidence              REAL NOT NULL DEFAULT 1.0,
    last_used_ms            INTEGER NOT NULL,
    use_count               INTEGER NOT NULL DEFAULT 0,
    tags_json               TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX idx_decisions_created  ON decisions(created_at_ms DESC);
CREATE INDEX idx_decisions_active   ON decisions(superseded_by) WHERE superseded_by IS NULL;
CREATE INDEX idx_decisions_scope    ON decisions(scope, module);

CREATE VIRTUAL TABLE decisions_fts USING fts5(
    id UNINDEXED,
    title,
    rationale,
    content='decisions'
);
-- Triggers ai/ad/au analogos a turns_fts
```

**Regla:** decisions con `superseded_by IS NOT NULL` se excluyen de
`mem.recall` por default (salvo `include_superseded: true`).

### 4.4 Tabla `learnings`

```sql
CREATE TABLE learnings (
    id                  TEXT PRIMARY KEY,
    created_at_ms       INTEGER NOT NULL,
    content             TEXT NOT NULL,
    trigger             TEXT,
    scope               TEXT NOT NULL DEFAULT 'project',
    module              TEXT,
    severity            TEXT NOT NULL DEFAULT 'tip',
    confidence          REAL NOT NULL DEFAULT 1.0,
    last_used_ms        INTEGER NOT NULL,
    use_count           INTEGER NOT NULL DEFAULT 0,
    tags_json           TEXT NOT NULL DEFAULT '[]',
    consolidated_into   TEXT
);

CREATE INDEX idx_learnings_created  ON learnings(created_at_ms DESC);
CREATE INDEX idx_learnings_severity ON learnings(severity);
CREATE INDEX idx_learnings_active   ON learnings(consolidated_into) WHERE consolidated_into IS NULL;

CREATE VIRTUAL TABLE learnings_fts USING fts5(
    id UNINDEXED,
    content,
    trigger,
    content='learnings'
);
-- Triggers
```

**Severity afecta decay:**
- `tip` → decay normal
- `warning` → decay 50% mas lento
- `critical` → no decay (siempre aparece si la query es relevante)

### 4.5 Tabla `entities`

```sql
CREATE TABLE entities (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    entity_kind     TEXT NOT NULL,
    description     TEXT NOT NULL,
    location        TEXT,
    created_at_ms   INTEGER NOT NULL,
    updated_at_ms   INTEGER NOT NULL,
    confidence      REAL NOT NULL DEFAULT 1.0,
    last_used_ms    INTEGER NOT NULL,
    use_count       INTEGER NOT NULL DEFAULT 0,
    tags_json       TEXT NOT NULL DEFAULT '[]',
    UNIQUE (name, entity_kind)
);

CREATE INDEX idx_entities_name ON entities(name);
CREATE INDEX idx_entities_kind ON entities(entity_kind);

CREATE VIRTUAL TABLE entities_fts USING fts5(
    id UNINDEXED,
    name,
    description,
    content='entities'
);
-- Triggers
```

### 4.6 Tabla `relations`

```sql
CREATE TABLE relations (
    id              TEXT PRIMARY KEY,
    from_entity_id  TEXT NOT NULL,
    to_entity_id    TEXT NOT NULL,
    relation        TEXT NOT NULL,
    created_at_ms   INTEGER NOT NULL,
    confidence      REAL NOT NULL DEFAULT 1.0,
    FOREIGN KEY (from_entity_id) REFERENCES entities(id),
    FOREIGN KEY (to_entity_id)   REFERENCES entities(id),
    UNIQUE (from_entity_id, to_entity_id, relation)
);

CREATE INDEX idx_relations_from ON relations(from_entity_id);
CREATE INDEX idx_relations_to   ON relations(to_entity_id);
```

### 4.7 Tabla `tasks`

```sql
CREATE TABLE tasks (
    id              TEXT PRIMARY KEY,
    title           TEXT NOT NULL,
    description     TEXT,
    status          TEXT NOT NULL DEFAULT 'pending',
    priority        TEXT NOT NULL DEFAULT 'medium',
    created_at_ms   INTEGER NOT NULL,
    updated_at_ms   INTEGER NOT NULL,
    completed_at_ms INTEGER,
    blocked_by_json TEXT NOT NULL DEFAULT '[]',
    notes_json      TEXT NOT NULL DEFAULT '[]',
    tags_json       TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX idx_tasks_status_priority ON tasks(status, priority);
```

**Mapping defensivo `tasks.status` (decision Tarea 5.6 architect
review, B-010):** el schema declara `DEFAULT 'pending'` pero el
**domain** (`code/src/modules/memory/domain/value-objects/task-status.ts`)
modela los estados como:

| `tasks.status` (SQL) | `TaskStatus` (domain) | Nota |
|---|---|---|
| `'pending'` | `'todo'` | **Mapping defensivo en `SqliteTaskRepository`**: al leer normaliza `pending → todo`. Las nuevas filas se escriben como `'todo'` directo. |
| `'in_progress'` | `'in_progress'` | Coincidencia textual |
| `'done'` | `'done'` | Coincidencia textual |
| `'blocked'` | `'blocked'` | Coincidencia textual |

El mapping defensivo en
`code/src/modules/memory/infrastructure/persistence/sqlite-task-repository.ts`
absorbe filas legacy (creadas antes de la mitigacion) y filas nuevas
sin perder consistencia. `TaskStatus.from(raw)` aplica la
normalizacion en una sola funcion auditable.

**Decision arquitectonica (ADR informal, MVP v0.1.0):** mantener el
mapping defensivo permanente. Para v0.5+ se evaluara una migracion
follow-up que `UPDATE tasks SET status='todo' WHERE status='pending'`
y `ALTER COLUMN DEFAULT 'todo'` para alinear schema → domain.
Mientras tanto, **cualquier query manual** sobre la tabla `tasks`
debe considerar ambos valores como sinonimos.

### 4.8 Tabla `audit_log`

```sql
CREATE TABLE audit_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp_ms    INTEGER NOT NULL,
    tool_name       TEXT NOT NULL,
    args_summary    TEXT,
    duration_ms     INTEGER,
    error_code      TEXT
);

CREATE INDEX idx_audit_time ON audit_log(timestamp_ms DESC);
```

Politica: rolling 90 dias.

### 4.9 Tabla `pruned`

```sql
CREATE TABLE pruned (
    id                  TEXT PRIMARY KEY,
    original_table      TEXT NOT NULL,
    original_id         TEXT NOT NULL,
    content_snapshot    TEXT NOT NULL,
    pruned_at_ms        INTEGER NOT NULL,
    reason              TEXT
);
```

Audit trail para entries borrados por curador o `mem.forget`. Permite
recovery por 30 dias antes de borrarse fisicamente.

### 4.10 Tabla `embedding_queue`

```sql
CREATE TABLE embedding_queue (
    id              TEXT PRIMARY KEY,
    table_name      TEXT NOT NULL,
    row_id          TEXT NOT NULL,
    enqueued_at_ms  INTEGER NOT NULL,
    attempts        INTEGER NOT NULL DEFAULT 0,
    last_error      TEXT
);

CREATE INDEX idx_emb_queue_pending ON embedding_queue(enqueued_at_ms);
```

Cola de embeddings pendientes (ver async embeddings en arquitectura). El
worker procesa en background, una vez completado borra de la cola.

### 4.11 Tabla `curator_runs`

```sql
CREATE TABLE curator_runs (
    id                      TEXT PRIMARY KEY,
    started_at_ms           INTEGER NOT NULL,
    ended_at_ms             INTEGER,
    duration_ms             INTEGER,
    decay_applied_to        INTEGER,
    consolidations          INTEGER,
    pruned                  INTEGER,
    stale_marked            INTEGER,
    conflicts_detected      INTEGER,
    reembedded              INTEGER,
    size_before_bytes       INTEGER,
    size_after_bytes        INTEGER,
    success                 INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_curator_runs_time ON curator_runs(started_at_ms DESC);
```

---

## 5. SQLite: `vectors.db`

Separado de `recall.db` para que se pueda regenerar sin tocar el resto
estructurado (re-embed cuando cambia el modelo).

```sql
-- sqlite-vec extension cargada al abrir
CREATE VIRTUAL TABLE embeddings USING vec0(
    id          TEXT PRIMARY KEY,
    vec         FLOAT[384]               -- dim variable: 384 / 768 / 1024
);

CREATE TABLE embedding_metadata (
    id              TEXT PRIMARY KEY,
    table_name      TEXT NOT NULL,        -- 'turns' | 'decisions' | ...
    row_id          TEXT NOT NULL,
    embedded_text   TEXT NOT NULL,        -- el texto que se embebio (debugging)
    model_name      TEXT NOT NULL,        -- 'BGESmallEN15' | ...
    dimension       INTEGER NOT NULL,
    created_at_ms   INTEGER NOT NULL,
    UNIQUE (table_name, row_id, model_name)
);

CREATE INDEX idx_emb_meta_origin ON embedding_metadata(table_name, row_id);
CREATE INDEX idx_emb_meta_model  ON embedding_metadata(model_name);
```

**Ciclo:**
1. Se inserta entry en `recall.db`.
2. Worker async lee `embedding_queue`, computa embedding del
   `searchable_text`.
3. Inserta en `embeddings` + `embedding_metadata`, borra de cola.
4. Si modelo cambia, curador re-embebe en background.

**searchable_text por kind:**
- `decision`: `title + "\n" + rationale`
- `learning`: `content + "\n" + (trigger ?? "")`
- `entity`: `name + " " + entity_kind + "\n" + description`
- `turn`: `summary + "\n" + (intent ?? "") + "\n" + (outcome ?? "")`

---

## 6. Migraciones

### Filosofia: lazy por proyecto

Cuando se actualiza el binario del MCP a una version con schema nueva, las
DBs en proyectos existentes NO se migran inmediatamente. Se migran al
primer `tool call` sobre ese workspace.

### Flujo

Al abrir `recall.db`:

1. Lee `PRAGMA user_version` (o tabla `_meta` si schema_version es texto).
2. Compara con `CURRENT_SCHEMA_VERSION` del binario.
3. Si igual → continua.
4. Si binario > DB → ejecuta migraciones pendientes en transaccion:
   - Snapshot pre-migracion: `cp recall.db snapshots/<ts>-pre-migration.db`.
   - Aplica scripts de `migrations/NNN_*.sql` en orden.
   - Actualiza `user_version`.
   - Si modo encrypted, las migraciones corren con la DB unlocked.
5. Si binario < DB (downgrade) → error claro: "Tu binario es viejo, actualiza
   o renombra `.recall/` y empieza de cero".

### Estructura de migraciones

```
migrations/
├── 001_initial.sql
├── 002_add_severity_to_learnings.sql
├── 003_add_consolidated_into.sql
├── 004_add_fts5_tables.sql
├── 005_add_embedding_queue.sql
└── ...
```

Cada migracion:
- Es idempotente (`IF NOT EXISTS`, `ALTER TABLE` con check).
- Es transaccional.
- Actualiza `user_version` al final.
- Documenta en comment que cambia.

### Migracion del modelo embedder

Si el usuario cambia `embedder.model` (en config global o por proyecto):

1. Curador detecta mismatch entre `embedding_metadata.model_name` y model
   actual.
2. Encola jobs de re-embed en `embedding_queue` para todos los entries.
3. Worker procesa en background.
4. Mientras tanto, recall usa los embeddings viejos (cosine compatible
   solo si dimension igual; si no, fallback a FTS5 puro).

---

## 7. Compactacion fisica

Cada N dias o cuando `PRAGMA freelist_count > 1000`:

```sql
PRAGMA optimize;
VACUUM;
```

Para `vectors.db` el rebuild de indice se hace via funciones de sqlite-vec.

Si modo encrypted, VACUUM mantiene cifrado (SQLCipher es transparente para
SQL).

---

## 8. Backup automatico

### Pre-curator
Antes de cada `mem.curator_run`:
```
cp recall.db snapshots/<ts>-pre-curator.db
cp vectors.db snapshots/<ts>-pre-curator-vectors.db
```
Mantiene los ultimos 5 snapshots, borra los demas.

### Pre-migration
Antes de aplicar migraciones de schema:
```
cp recall.db snapshots/<ts>-pre-migration-v<old>-to-v<new>.db
```
Permanente (no se rota).

### Pre-rekey
Antes de `recall rekey`:
```
cp recall.db snapshots/<ts>-pre-rekey.db
cp vectors.db snapshots/<ts>-pre-rekey-vectors.db
```
Mantiene ultimos 2.

---

## 9. Tamanos esperados

Estimacion para un proyecto activo de 6 meses con ~200 sesiones:

| Tabla | Filas | Tamano |
|---|---|---|
| sessions | 200 | ~50 KB |
| turns | 5,000 | ~3 MB |
| turns_fts | (FTS shadow) | ~2 MB |
| decisions | 100 | ~80 KB |
| decisions_fts | | ~50 KB |
| learnings | 800 | ~500 KB |
| learnings_fts | | ~300 KB |
| entities | 500 | ~300 KB |
| entities_fts | | ~200 KB |
| relations | 1,500 | ~150 KB |
| tasks | 200 | ~80 KB |
| audit_log | 50,000 | ~5 MB |
| embeddings | ~6,500 vectores * 384 floats | ~10 MB |
| embedding_metadata | 6,500 | ~1 MB |

**Total: ~25 MB por proyecto activo.** Razonable para versionar en git
(modos `shared` y `encrypted`).

Politica de pruning si crece:
- audit_log: rolling, keep last 90 dias.
- turns con confidence < 0.2 → pruning.
- learnings consolidados: borrar despues de 30 dias en `consolidated_into`.

---

## 10. Por que SQLite y no X

| Alternativa | Por que no |
|---|---|
| LanceDB | Mas potente para vectores grandes pero pesa mas (Rust runtime), overkill para < 100K vectores |
| Postgres | Requiere servidor. Out of scope para memoria-en-proyecto |
| LevelDB / RocksDB | KV pelado, sin SQL ni FTS5 |
| JSON files | Sin indices, sin transacciones, sin queries semanticas |
| Qdrant | Excelente vector DB pero requiere server |
| Chroma | Bueno pero deps Python; el server es TS |

SQLite + FTS5 + sqlite-vec + SQLCipher ofrece:
- Single binary deploy
- Transacciones ACID
- Hybrid search nativo (FTS5 + vec)
- Cifrado opcional sin cambiar API
- Performance suficiente hasta 1M vectores
- Backupable con `cp`

---

## 11. Por que separar `recall.db` y `vectors.db`

- Re-embed (cambio de modelo) toca solo `vectors.db`. `recall.db` queda
  intacto.
- `vectors.db` es regenerable desde `recall.db` + el modelo. Es esencial
  cache, no fuente de verdad.
- En modo encriptado, ambos se cifran con la misma clave (consistencia).
- Permite que `vectors.db` este en `.gitignore` incluso en modo `shared`
  para repos publicos donde no queremos versionar 10 MB de blobs binarios
  (opt-in via `config.json → vectors.versioned: false`). Es regenerable al
  hacer pull.

---

## 12. Que NO esta en el modelo de datos

- **Codigo fuente.** No se almacena. Se referencia por path:line en
  `entities.location`.
- **Output de comandos.** No se almacena.
- **Conversacion completa.** Solo turnos resumidos.
- **Diff de Git.** El cliente accede via `git`.
- **Capa global cross-proyecto.** Out of scope MVP. Para preferencias del
  usuario, `~/.claude/CLAUDE.md`.
