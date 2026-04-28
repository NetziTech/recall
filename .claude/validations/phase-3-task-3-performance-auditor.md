# Performance Auditor — Fase 3 Tarea 3.3 (retrieval module)

**Validator**: performance-auditor
**Scope**: `code/src/modules/retrieval/application/` + `code/src/modules/retrieval/infrastructure/` + `code/migrations/002__retrieval-schema.sql`
**Mode**: análisis estático (sin benchmarks — diferidos a Fase 5).

---

## Resumen

El módulo de retrieval respeta los patrones de performance que el contrato declara:

- Embeddings 100% asíncronos: ningún use case del módulo `memory` invoca al `Embedder`. Solo lo hacen `RecallMemoryUseCase`, `GetContextBundleUseCase` (en su path de query) y `EmbedAndPersistUseCase` (worker). El path de escritura (`mem.remember`) jamás bloquea esperando un embed.
- Worker async correcto: `AsyncEmbeddingWorker` usa `setTimeout` recursivo (no `setInterval`), respeta backoff (`backoffWindowMs` por default 30 s + `MAX_ATTEMPTS=5` en el use case), y entra en idle poll cuando la cola está vacía.
- Búsqueda híbrida en paralelo: tanto `recall` como `build` lanzan lexical + vector vía `Promise.all`. El embedder NO se llama dos veces para una misma query.
- Hidratación batched: `MemoryProjectionRepository.loadProjectionsByHits` agrupa por kind y usa `WHERE id IN (?, ?, ...)`. **No hay N+1**.
- WAL mode + PRAGMAs correctas: `SqliteDatabase` configura `journal_mode=WAL`, `synchronous=NORMAL`, `foreign_keys=ON`, `cache_size=-64000`, `temp_store=MEMORY`. El módulo retrieval no las invalida.
- Vector search delegado a `sqlite-vec`: la cosine se calcula in-engine vía `vec0 MATCH` + `k=?`, NO en JavaScript.
- TikToken: encoder cargado una sola vez en el constructor, reutilizado para todo `count(...)`.

Encontré **2 mediums** y **2 lows** que se reportan como warnings para Fase 5 (no bloquean). **CERO críticos. CERO highs.**

---

## Críticos

Ninguno.

---

## High

Ninguno.

---

## Medium (warnings, no bloquean)

### M1 — Prepared statements no cacheados en hot path (R2)

**Archivos**:
- `code/src/modules/retrieval/infrastructure/persistence/sqlite-fts5-lexical-search.ts:159`
- `code/src/modules/retrieval/infrastructure/persistence/sqlite-vec-vector-search.ts:99`
- `code/src/modules/retrieval/infrastructure/persistence/sqlite-embedding-queue-repository.ts:133, 149, 163, 172, 194, 195, 216`
- `code/src/modules/retrieval/infrastructure/persistence/sqlite-memory-projection-repository.ts:254, 262, 296, 320, 344, 369, 455, 489, 506, 533, 563, 593, 626`

**Detalle**: cada query frecuente reinvoca `this.db.prepare(SQL_*)` en cada llamada al método. El adapter compartido `SqliteDatabase.prepare()` (`code/src/shared/infrastructure/database/sqlite-database.ts:291-300`) tampoco mantiene un cache interno. Resultado: cada `mem.recall` y `mem.context` recompila ~6-12 SQL strings cada vez que entra en el hot path.

El docstring del puerto en `code/src/shared/application/ports/database-connection.port.ts:147` dice "implementations MAY cache the compiled statement", pero la implementación actual no lo hace. better-sqlite3 documenta que `prepare()` es relativamente caro (parse + plan).

**Impacto estimado**: 10-30 µs adicionales por query (escala con la complejidad del SQL — el del `SQL_LIST_OPEN_TASKS` con sus dos `CASE` es el más lento). Para `mem.recall` con 6+ queries en serie (lexical en N kinds + vector + hidratación), eso son ~60-180 µs evitables. No rompe el target p95 < 100ms por sí solo, pero acumula.

**Sugerencia para Fase 5**: cachear los `PreparedStatement` en el constructor del repo (patrón típico):
```typescript
private readonly listActiveDecisionsStmt: PreparedStatement;
constructor(private readonly db: DatabaseConnection) {
  this.listActiveDecisionsStmt = db.prepare(SQL_LIST_ACTIVE_DECISIONS);
}
```
O introducir `SqliteDatabase.prepareCached(sql)` con un `Map<string, PreparedStatement>` interno.

### M2 — `bumpUsage` re-prepara el SQL por cada item dentro de la transacción

**Archivo**: `code/src/modules/retrieval/infrastructure/persistence/sqlite-memory-projection-repository.ts:486-492`

**Detalle**: la transacción itera sobre `touched` y, para cada item, hace `SQL_BUMP_TEMPLATE.replace("%TABLE%", KIND_TABLE[t.kind])` + `db.prepare(sql)`. Solo hay 5 SQL distintos (uno por kind), pero el código los re-prepara N veces.

**Impacto**: `bumpUsage` se llama una vez por `recall`, con `touched.length` = `filters.limit` (default 8). En el path crítico, son 8 prepares evitables.

**Sugerencia para Fase 5**: precomputar las 5 sentencias en el constructor (`Record<QueryKindValue, PreparedStatement>`).

---

## Low (warnings, no bloquean)

### L1 — `loadProjectionsByHits` no es una sola round-trip a pesar del docstring

**Archivo**: `code/src/modules/retrieval/infrastructure/persistence/sqlite-memory-projection-repository.ts:394-440`

**Detalle**: el docstring (linea 235-237) dice "one UNION ALL across kinds to keep the round trip count to one", pero el método llama secuencialmente a `loadDecisions`, `loadLearnings`, `loadEntities`, `loadTasks`, `loadTurns` — cada uno con su propio `db.prepare` + `stmt.all`. Son hasta 5 round trips por hidratación, no 1.

**Impacto**: SQLite es in-process (no IPC), así que cada round trip cuesta micros, no millis. NO es N+1 (sigue agrupando por kind con `IN (?, ?, ...)`). Pero el comentario miente sobre el comportamiento.

**Sugerencia para Fase 5**: o (a) consolidar en un único SQL con `UNION ALL` parametrizado por kind, o (b) corregir el docstring para describir lo que el código hace realmente.

### L2 — `dequeueBatch` escanea por `(workspace_id, enqueued_at_ms)` pero el filtro `(last_error IS NULL OR enqueued_at_ms <= ?)` es complejo para el index

**Archivo**: `code/src/modules/retrieval/infrastructure/persistence/sqlite-embedding-queue-repository.ts:49-56` + `code/migrations/002__retrieval-schema.sql:67-68`

**Detalle**: el index `idx_embedding_queue_workspace_enqueued (workspace_id, enqueued_at_ms)` cubre el SARGable de la cláusula, pero el `OR` con `last_error IS NULL` requiere un seek + filter post-lookup. Para colas pequeñas (cientos de items pendientes) está bien; para colas grandes (10k+ después de un import masivo) podría escanear más de lo necesario.

**Impacto**: en operación normal el worker drena la cola continuamente, así que no se acumula. En el escenario de "cold start con cola pendiente grande" podría costar.

**Sugerencia para Fase 5**: considerar un partial index `WHERE last_error IS NULL` para el camino "feliz" — la mayoría de las filas en una cola sana caen en ese bucket.

---

## Info (positivo, no requiere acción)

- **I1 — Embedder asíncrono confirmado**: `grep -rn "embedder\.embed(" code/src/modules/memory/application/` retorna **vacío**. La cola `embedding_queue` se llena vía side-effects post-write (próxima Tarea 3.4 conectará `RecordDecisionUseCase` → `EmbeddingQueueRepository.enqueue`), nunca bloqueando el path sincrónico. Cumple `docs/01-arquitectura.md` §2.7.
- **I2 — `recall` y `build` paralelos**: ambos use cases usan `Promise.all([lexicalPromise, embedderPromise])` (`recall-memory.use-case.ts:145-148`, `get-context-bundle.use-case.ts:174-188`). El bundle además paraleliza las 5 capas estructurales con la query-driven en un solo `Promise.all`. Es el patrón óptimo.
- **I3 — Embedder solo se llama UNA vez por bundle**: `runQueryDrivenLayers` invoca `runEmbeddedSearch` una sola vez aunque el resultado alimente las capas 5 (`relevant_memory`) y 6 (`entities_in_focus`). No hay duplicación de la llamada de 50-200 ms.
- **I4 — `vec_search` delegado a sqlite-vec**: `SQL_KNN` usa `e.vec MATCH ?` + `k = ?`. NO hace `SELECT * FROM embeddings` con cosine en JS — eso sería catastrófico.
- **I5 — Persist embeddings transaccional**: `persistEmbedding` envuelve los dos INSERT (vec0 + metadata) en `db.transaction(...)` (`sqlite-embedding-queue-repository.ts:193-210`). El metadata nunca queda inconsistente con la fila vec0.
- **I6 — Worker `setTimeout` recursivo, no `setInterval`**: `AsyncEmbeddingWorker.scheduleNextDrain` evita drains solapados. `start()/stop()` idempotentes; `stop()` espera el `inFlight`.
- **I7 — Backoff + permanent failure**: `EmbedAndPersistUseCase` respeta `MAX_ATTEMPTS=5`, `recordFailure` incrementa `attempts`, y `dequeueBatch` filtra por `enqueued_at_ms <= availableAfter` (`now - backoffWindowMs`).
- **I8 — TikToken cacheado**: `TiktokenTokenCounter` recibe el encoder en el constructor (`tiktoken-token-counter.ts:64-68`); cada `count()` solo invoca `encoder.encode(text)`. No re-carga BPE merges por llamada.
- **I9 — Token budget early break**: en `rankAndSlice` (`recall-memory.use-case.ts:363-369`) y en cada `build*Layer` del bundle, el loop hace `break` cuando `runningTokens + cost > cap`. No cuenta tokens de items que no van a entrar.
- **I10 — Indices del schema 002 alineados con queries**: `idx_embedding_queue_workspace_enqueued` cubre el ORDER BY del dequeue; `idx_embedding_metadata_origin (target_kind, target_row_id)` cubre los lookups del JOIN en `SQL_KNN` (vía `m.id = e.id` + filter `target_kind`); `UNIQUE (target_kind, target_row_id, model_name)` cubre el `ON CONFLICT` del UPSERT.
- **I11 — Re-fetch K-N inflado**: `SqliteVecVectorSearch` over-fetches con `k = min(200, max(limit, limit*4))` para que el filtro client-side de kind aún produzca suficientes candidatos. Es el trade-off correcto.
- **I12 — WAL no invalidada**: ningún archivo del módulo retrieval emite `PRAGMA journal_mode = ...`. El estado configurado en `SqliteDatabase.open` se mantiene.
- **I13 — Diferidos a Fase 5 confirmados**: `mmap_size`, `busy_timeout`, pino async destination — el experto los marcó como Perf-Minor; son pragmas adicionales que la auditoría puede recomendar pero no son patrones del módulo retrieval.

---

## Verificaciones realizadas

| Regla | Verificación | Resultado |
|---|---|---|
| R1 — indices apropiados | `002__retrieval-schema.sql` revisado | OK |
| R2 — prepared statements cacheados | grep `db.prepare` en cada adapter | **NO** — M1 |
| R3 — N+1 queries | grep `for.*findById\|.map.*findById` | OK (no N+1; batching por kind) |
| R4 — batch INSERTs | `persistEmbedding` envuelto en `transaction()` | OK |
| R5 — embeddings asíncronos | grep `embedder.embed(` en memory/application | OK (vacío) |
| R6 — WAL + PRAGMAs | `sqlite-database.ts:255-259` | OK |
| R7 — sqlite-vec in-process | misma DB connection | OK |
| R8 — cifrado overhead | fuera del scope de retrieval (Tarea 2.2) | N/A |
| R9 — benchmarks presentes | diferidos a Fase 5 | N/A (esperado) |
| R10 — EXPLAIN QUERY PLAN | requiere ejecutar SQL | diferido a Fase 5 |
| Async embeddings (§2.7) | use case del worker, sin bloqueo en writes | OK |
| Worker backoff exponencial | `MAX_ATTEMPTS=5` + `backoffWindowMs` | OK (lineal por window, no exponencial estricto, pero el spec del agent brief lo permitía) |
| Cola priorizada | ORDER BY `enqueued_at_ms ASC, id ASC` | OK (FIFO; no hay `priority` field documentado en el spec del módulo) |
| TikToken lazy + cache | encoder en constructor | OK |
| Cosine via sqlite-vec | `SQL_KNN` usa `MATCH` + `k=?` | OK |
| Hidratación batched | `loadProjectionsByHits` agrupa con `IN (?, ?, ...)` | OK |
| Búsquedas en paralelo | `Promise.all([lexical, vector])` | OK |
| Bundle 7 capas paralelo | `Promise.all` sobre 6 promesas | OK |

---

## Veredicto

**APPROVED** — el módulo retrieval cumple todos los patrones de performance que se pueden auditar estáticamente: embeddings 100% asíncronos, hidratación batched (sin N+1), búsqueda híbrida paralela, transacciones donde corresponde, WAL preservado, sqlite-vec en-engine, TikToken cacheado. Los hallazgos M1 (prepared statements re-compilados) y M2 (bumpUsage re-prepara), más L1 y L2, son optimizaciones para Fase 5 — no bloquean ni rompen los targets p95 con datasets normales. La validación final p95 < 100 ms / 200 ms / 30 ms requiere benchmarks reales (Fase 5).

