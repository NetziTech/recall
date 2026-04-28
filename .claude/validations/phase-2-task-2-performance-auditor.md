# Auditoría de performance — Fase 2 / Tarea 2.2 (shared/infrastructure)

- **Auditor**: `performance-auditor`
- **Fecha**: 2026-04-27
- **Veredicto**: **APROBADO_CON_OBSERVACIONES**
- **Alcance**: `code/src/shared/infrastructure/{database,embedder,logger}/` + `code/migrations/000__bootstrap.sql`

> Resumen de una línea: la base de performance está correctamente sembrada (WAL, NORMAL, FK ON, vec lazy, embedder lazy, transacciones immediate). Los hallazgos son de tono *minor/info* y se resuelven en Fase 3 (cuando se introduzcan repos concretos) y Fase 5 (benchmarks E2E). No hay bloqueantes para avanzar.

---

## Tabla de checks (1–19)

| # | Check | Resultado | Comentario |
|---|---|---|---|
| 1 | `journal_mode = WAL` | OK | `sqlite-database.ts:255`. Aplicado tras SQLCipher unlock; correcto. |
| 2 | `synchronous = NORMAL` | OK | `sqlite-database.ts:256`. Compromiso adecuado durabilidad/throughput. |
| 3 | `temp_store = MEMORY` | OK | `sqlite-database.ts:259`. Operaciones intermedias en RAM. |
| 4 | `cache_size` razonable | OK | `sqlite-database.ts:258` → `-64000` (64 MiB). Coincide con doc/06 §4. |
| 5 | `foreign_keys = ON` | OK | `sqlite-database.ts:257`. Correctness sobre performance, correcto. |
| 6 | `mmap_size` considerado | **MISSING (minor)** | No se setea. Recomendado `268435456` (256 MiB) para datasets >50K entries. Ver hallazgo M-1. |
| 7 | `busy_timeout` seteado | **MISSING (minor)** | No se setea. Bajo concurrencia (curador async + recall) puede salir `SQLITE_BUSY`. Recomendado `5000`. Ver hallazgo M-2. |
| 8 | Reutilización de prepared statements | **MIXED (minor)** | `SqliteDatabase.prepare()` no cachea internamente (correcto: el caching es responsabilidad del repo). PERO `MigrationsRunner.applyMigration` re-prepara `INSERT INTO schema_migrations` por cada migración (`migrations-runner.ts:234`). Aceptable para bootstrap (corre 1x por arranque, ~10 migraciones max), pero documentar como límite. Ver hallazgo m-1. |
| 9 | No queries N+1 en infra compartida | OK | No hay loops con `prepare`/`exec` por iteración en hot path. El loop de migraciones es intencional (cada una en su tx). |
| 10 | Transacciones agrupan writes | OK | `sqlite-database.ts:311-332`. `MigrationsRunner` envuelve cada migración en tx. |
| 11 | `transaction(fn)` en modo correcto | OK | `sqlite-database.ts:319` usa `tx.immediate()`. Decisión explícita y correcta para evitar starvation con FTS5/curador (doc/05 §3). |
| 12 | `embed` async (no bloquea writes) | OK | `fastembed-embedder.ts:141,151` retornan `Promise<...>`. La cola sincrónica de write se diseña en módulo `retrieval`, no aquí. |
| 13 | `embedBatch` es batch real | **OK (info)** | `fastembed-embedder.ts:163` invoca `model.embed([...texts], texts.length)` con el `batch_size` igual al tamaño total → fastembed corre 1 sola pasada ONNX para todo el lote. NO es un `Promise.all(map)` falso. Correcto. |
| 14 | Lazy loading del modelo | OK | `fastembed-embedder.ts:127-135` no toca disco/red en el constructor. Modelo se carga en primer `embed()` vía `ensureModel()`. Cold start MCP `initialize` no impactado. |
| 15 | Pino async mode | **NEEDS-VERIFY (minor)** | `pino-logger.ts:144` invoca `pino(pinoOptions)` sin pasar `destination` explícito. Pino por default escribe a stdout sync. Bajo carga (≥1k logs/s) puede dominar el budget de `mem.recall`. Ver hallazgo M-3. |
| 16 | Redact paths cantidad razonable | OK | 31 paths en `DEFAULT_REDACT_PATHS` (`pino-logger.ts:28-60`). Pino los compila a un autómata; el costo es despreciable bajo 50. |
| 17 | Constructor no bloquea | OK | `SqliteDatabase` constructor privado, solo asignaciones; `FastembedEmbedder` constructor solo asigna; `PinoLogger` privado. |
| 18 | `SqliteDatabase.open` orden de PRAGMAs correcto | OK | Orden: (a) cipher+key, (b) WAL, (c) sync, (d) FK, (e) cache+temp, (f) loadExtension. SQLCipher antes de WAL es OBLIGATORIO (la página 1 se descifra antes de cambiar journal). Validado en doc/06 §4-5. |
| 19 | `migrations/000__bootstrap.sql` indexes | N/A | Solo crea tabla `_meta(key PK, value)`. PRIMARY KEY ya induce índice. No requiere indices adicionales. |

---

## Hallazgos clasificados

### Critical
*(ninguno)*

### Major
*(ninguno)*

### Minor

**M-1 — `mmap_size` no configurado**
- **Archivo**: `code/src/shared/infrastructure/database/sqlite-database.ts:255-259`
- **Detalle**: SQLite por default no usa memory-mapped I/O. Para datasets de 50K entries con FTS5 + sqlite-vec, mmap puede recortar 10-30% el costo de scans secuenciales sobre páginas frías.
- **Impacto sobre target**: bajo. `mem.recall p95 < 100ms` se cumple sin mmap si los índices están correctos. Pero deja headroom para cuando el dataset crezca.
- **Sugerencia**: añadir `raw.pragma("mmap_size = 268435456");` (256 MiB) tras `temp_store = MEMORY`. Confirmar con benchmark Fase 5 antes/después.

**M-2 — `busy_timeout` no configurado**
- **Archivo**: `code/src/shared/infrastructure/database/sqlite-database.ts:255-259`
- **Detalle**: Sin `busy_timeout`, una colisión entre el worker del curador (background) y un `mem.recall` puede devolver `SQLITE_BUSY` inmediato. Con WAL los lectores no bloquean escritores y viceversa, pero un `BEGIN IMMEDIATE` simultáneo SÍ puede colisionar.
- **Impacto sobre target**: medio si se materializa. Falla intermitente en producción es peor que +5ms de latencia en p99.
- **Sugerencia**: `raw.pragma("busy_timeout = 5000");` Es la práctica estándar de better-sqlite3 + WAL.

**M-3 — Pino destination en modo síncrono (default)**
- **Archivo**: `code/src/shared/infrastructure/logger/pino-logger.ts:144`
- **Detalle**: `pino(pinoOptions)` sin `destination` explícito → pino escribe a stdout en modo sync. En modo `pretty` ya hay un transport (worker thread async, OK). En modo producción (no-pretty) los `info`/`debug` durante `mem.recall` se serializan en el hilo principal.
- **Impacto sobre target**: bajo a medio. Pino sync es ~5-10x más lento que async bajo carga, pero el throughput de logs en MCP es bajo (1-3 líneas por request). Aun así, bajo `LOG_LEVEL=debug` puede comerse 5-10ms de p95.
- **Sugerencia (no urgente)**: en producción usar `pino.destination({ sync: false })` o `pino.transport({ targets: [{ target: 'pino/file', options: { destination: 1, sync: false } }] })`. Decidir tras benchmark Fase 5; si `mem.recall` p95 con `LOG_LEVEL=info` cumple el target, no tocar.

### Minor (estilo/convención)

**m-1 — `MigrationsRunner` re-prepara `INSERT schema_migrations` por migración**
- **Archivo**: `code/src/shared/infrastructure/database/migrations-runner.ts:234-237`
- **Detalle**: cada llamada a `applyMigration` invoca `db.prepare(...)`. Esto corre N veces (1 por migración pendiente) en cada arranque. Para N≤20 es despreciable (≤2ms total).
- **Impacto sobre target**: ninguno. El bootstrap de migraciones NO está en el budget de cold start <200ms (las migraciones corren UNA vez post-arranque, no en el path de `initialize`).
- **Sugerencia**: documentar el límite (`MAX_MIGRATIONS_PER_BOOT`) o mover la `prepare` fuera del loop si en el futuro las migraciones individuales son frecuentes. No bloqueante.

### Info

**i-1 — `SqliteStatement.all()` clona+freezea el array por contrato del puerto**
- **Archivo**: `code/src/shared/infrastructure/database/sqlite-database.ts:131`
- **Detalle**: `Object.freeze([...rows])` agrega un O(n) por llamada. Para N=8 (target de `mem.recall`) es despreciable. Para N=1000 (escaneos del curador) puede sumar μs.
- **Impacto sobre target**: ninguno con los tamaños de página actuales (8-50 rows típicos). Mantener.
- **Sugerencia**: si Fase 5 muestra que esto domina en algún hot path, ofrecer una variante `iterate()` (ya disponible en `:137-143`) y consumirla con generator en repos batch.

**i-2 — Encryption key validation hace 1 round-trip extra**
- **Archivo**: `code/src/shared/infrastructure/database/sqlite-database.ts:363`
- **Detalle**: `SELECT count(*) FROM sqlite_master` en `applyEncryptionKey` agrega ~1ms al cold start con encryption. Es necesario para fallar determinísticamente. Cumple el target `<400ms` con holgura.
- **Sugerencia**: ninguna. Trade-off correcto de correctness > 1ms.

**i-3 — Modelo fastembed lazy: dimension() llamable antes del load**
- **Archivo**: `code/src/shared/infrastructure/embedder/fastembed-embedder.ts:137`
- **Detalle**: `pinnedDimension` se setea en constructor desde el catálogo estático. Permite que repos hagan `embedder.dimension()` sin disparar el load del ONNX (ej. al validar schema vec). Excelente para cold start.

---

## Recomendaciones para Fase 5 (cuando corramos benchmarks)

1. **Benchmarks E2E obligatorios** (cuando exista la suite):
   - `recall.bench.ts` — 1K / 10K / 50K entries → p95 `<100ms`.
   - `context-bundle.bench.ts` — 7 capas → p95 `<200ms`.
   - `remember.bench.ts` — sin esperar embed → p95 `<30ms`.
   - `cold-start.bench.ts` — sin/con encryption → `<200ms` / `<400ms`.

2. **Validar M-1 y M-2 con datos**: medir `mem.recall` p95 con/sin `mmap_size` y con/sin `busy_timeout` bajo concurrencia (curador + recall simultáneos). Si delta ≥5%, mergear los pragmas. Si no, dejar como está.

3. **Validar M-3 con `LOG_LEVEL=info` y `=debug`**: si el cambio entre niveles mueve el p95 más de 10ms, switch a pino async destination.

4. **`EXPLAIN QUERY PLAN` obligatorio en repos de Fase 3**: cada repo concreto que se escriba sobre este `SqliteDatabase` debe traer su matriz de `EXPLAIN QUERY PLAN` mostrando `SEARCH USING INDEX`, no `SCAN TABLE`. Sin esa matriz, REJECTED en su auditoría.

5. **`embedding_queue` worker**: cuando el módulo `retrieval` introduzca el worker, validar que `mem.remember` use solo `INSERT INTO embedding_queue` (no `await embedder.embed()`). Esa validación es de Fase 3, no de esta tarea.

6. **`vectors.db` mismo proceso**: cuando se introduzca el archivo separado para vectores (doc/03 §1), confirmar que se abre con la MISMA instancia de `BetterSqlite3` vía `ATTACH DATABASE`, no como handle aparte. Mantener IPC fuera del hot path.

7. **Benchmark del curador**: `curator.full-pass < 5s` con 10K entries. Verificar que usa `db.transaction()` en modo `immediate` y batch INSERTs (no inserts sueltos).

---

## Conclusión

`shared/infrastructure/` está bien sembrada para los targets de performance del producto. Los pragmas críticos (WAL, NORMAL, FK ON, cache_size, temp_store) están correctos y en orden válido respecto a SQLCipher. La transacción usa `immediate` (decisión correcta y documentada). El embedder es lazy y batch-real. El logger respeta el contrato no-throw.

**Veredicto final: APROBADO_CON_OBSERVACIONES.** Las observaciones M-1, M-2, M-3 son optimizaciones que NO bloquean Fase 3; se validan con benchmarks reales en Fase 5 y se aplican solo si los datos las justifican. La tarea 2.2 puede cerrarse y avanzar.
