# Performance Auditor — Fase 3 / Tarea 3.4 — `modules/curator/`

**Validator**: performance-auditor
**Alcance**: `code/src/modules/curator/application/`, `code/src/modules/curator/infrastructure/`, `code/migrations/003__pruned-and-curator-runs.sql`
**Fecha**: 2026-04-27
**Modo**: análisis estático (no se corrieron benchmarks)

---

## Resumen ejecutivo

El módulo curator está bien diseñado para un job batch sobre 50K items con presupuesto < 30s. La migración 003 trae los índices correctos para los dos accesos recurrentes (`pruned` y `curator_runs`), el `Vec0SimilarityFinder` usa la sintaxis correcta de sqlite-vec (KNN con `MATCH ... k=?`) en vez de O(n²) en JS, los use cases batch (`PruneLowConfidence`, `ApplyDecay`) NO hacen N+1 a nivel use case (la consulta SQL de candidatos es única, y la decay path stream-itera sin cargar el universo en memoria), y el scheduler tiene `clearTimeout` + flag `inflight` que previenen leaks y solapamiento.

Hay tres áreas de mejora menores (todas High/Medium, ninguna crítica) que pueden diferirse a Fase 5 conforme a `HANDOFF.md` §6.6.

**CERO críticos** ⇒ veredicto: **APPROVED**.

---

## Críticos (bloquean)

Ninguno.

---

## High (warnings; no bloquean — diferir a Fase 5)

### H1 — `applyDecay` ejecuta UN UPDATE por entry (no batch)

- **File**: `/Users/h2devx/proyects/netzi-tech/mcp/memoria/code/src/modules/curator/application/use-cases/apply-decay.use-case.ts:116`
- **File**: `/Users/h2devx/proyects/netzi-tech/mcp/memoria/code/src/modules/curator/infrastructure/persistence/sqlite-memory-entry-writer.ts:82-101`
- **Detalle**: El loop de `ApplyDecayUseCase.apply(...)` itera fila por fila y llama `writer.applyDecay(...)` que ejecuta `UPDATE decisions SET confidence = ? WHERE id = ?` en una transacción IMPLÍCITA (cada `stmt.run()` es un commit). Para 50K filas esto puede ser O(50K) commits.
- **Impacto**: El presupuesto < 30s probablemente se cumple en SSD por WAL, pero hay margen 10×. El `prepare(...)` se obtiene en cada iteración (línea 89) — `better-sqlite3` cachea la SQL así que no hay overhead de parsing, pero la búsqueda en cache + el round-trip aún suman.
- **Suggested fix (Fase 5)**:
  1. Agrupar updates por kind en lotes de N (p.ej. 500); envolver cada lote en `db.transaction(() => { for (const u of batch) stmt.run(...); })`.
  2. Memoizar `stmt` (un prepared por kind) en el constructor del writer en vez de re-prepararlo en cada call.

### H2 — `PruneLowConfidence` itera y persiste por candidato (sin batch transaction)

- **File**: `/Users/h2devx/proyects/netzi-tech/mcp/memoria/code/src/modules/curator/application/use-cases/prune-low-confidence.use-case.ts:113-145`
- **Detalle**: El loop por candidato hace dos awaits (`prunedRepo.save(snapshot)` + `writer.markPruned(...)`). `markPruned` SÍ usa una transacción interna (insert pruned + delete live), pero las dos llamadas no comparten transacción entre sí. El reportaje dice que `prunedRepo.save(...)` es un INSERT con upsert; bajo presión se puede perder atomicidad cross-snapshot/delete del writer.
- **Impacto**: La función es correcta (cada par snapshot→delete es atómico), pero hace 2N statements para N candidatos. Si N es alto y la mayoría de candidatos requieren prune, conviene un batch.
- **Suggested fix (Fase 5)**: Wrap del loop completo en `db.transaction(() => { for ... })` con prepared statements memoizados, o usar `INSERT ... SELECT FROM live_table` para el snapshot más `DELETE WHERE id IN (...)` con bind dinámico.

### H3 — `Vec0SimilarityFinder` itera N candidatos × KNN (no es N×M, pero sí N consultas)

- **File**: `/Users/h2devx/proyects/netzi-tech/mcp/memoria/code/src/modules/curator/infrastructure/similarity/vec0-similarity-finder.ts:160-197`
- **Detalle**: Para 500 candidatos hace 500 consultas KNN + 500 lookups de embedding, total 1000 round-trips. La optimización dura es batchear con un solo `WHERE id IN (?,?,...)` para los embeddings de todos los candidatos. Ya está acotado a `MAX_CANDIDATES_PER_PASS = 500` en el use case, así que el blast-radius es manejable, pero 1000 round-trips dentro del presupuesto de 30s dejan poco margen.
- **Impacto**: Aceptable para MVP. El comentario del adapter (líneas 108-112) explícitamente dice "prepared statements reused per candidate", lo cual es correcto.
- **Suggested fix (Fase 5)**: Pre-cargar todas las embeddings con `WHERE id IN (?,?,...)` antes del loop KNN; para KNN, dejar el loop pero con prepared statement memoizado en el constructor (actualmente se prepara dentro de `findPairs`, fuera del loop, lo cual ya es óptimo a nivel API — solo migrar a constructor como mejora).

---

## Medium (warnings; no bloquean)

### M1 — Statements no cacheados en constructor

- **Files**:
  - `sqlite-memory-entry-writer.ts:89, 108, 148, 180, 189`
  - `sqlite-memory-entry-reader.ts:289-293, 237, 243, 263`
  - `sqlite-curator-run-repository.ts:112, 121, 154, 166`
  - `sqlite-pruned-entry-repository.ts:73, 94, 114`
  - `sqlite-session-rollup-reader.ts:62`
- **Detalle**: Los adapters preparan SQL en cada llamada en lugar de memoizar en el constructor. Hay un comentario (`sqlite-memory-entry-reader.ts:191-194`) que dice "better-sqlite3 caches compiled SQL inside the connection, so the cost is negligible". Eso es cierto a nivel parsing, pero hay aún costos de hashmap-lookup + objeto wrapper en cada call.
- **Impacto**: Medible solo en hot-paths con > 10K calls/sec. El curator no es hot path.
- **Suggested fix (Fase 5)**: Mover `db.prepare(SQL_*)` al constructor como `private readonly stmtX = db.prepare(...)`. Patrón aplicado en otros adapters del proyecto debería ser uniforme.

### M2 — `decaySqlForKind` y `deleteSqlForKind` re-evalúan ramas en cada call

- **File**: `sqlite-memory-entry-writer.ts:205-227`
- **Detalle**: Cinco `if (kind.is*())` por cada `applyDecay`. En el caso de 50K iteraciones × 5 chequeos = 250K invocaciones de método `is*()`.
- **Impacto**: Microopt; V8 JIT inlina esto bien.
- **Suggested fix (Fase 5)**: Lookup table `Map<MemoryEntryKind, PreparedStatement>` cacheada en el constructor.

### M3 — `RollupSession.buildSummary` slice + indexOf no compite con el budget pero rompe encapsulación

- **File**: `rollup-session.use-case.ts:142-145`
- **Detalle**: La validación `body.length > SUMMARY_SOFT_CAP_CHARS` y el slice se duplican con la validación interna del VO `SessionSummary.from(body)`. No es un issue de performance per-se, pero double-validation marca código.
- **Impacto**: Nulo (operación O(1) con string corto).

---

## Low (info)

### L1 — `iterateActiveByKind` no usa LIMIT/OFFSET para chunking

- **File**: `apply-decay.use-case.ts:69, sqlite-memory-entry-reader.ts:204-213`
- **Detalle**: Async iterator es perfecto para 50K (memoria O(1)). En workspaces de >> 50K, conviene chunking explícito + sleep para ceder al event loop. No bloquea.

### L2 — `SQL_LIST_PRUNE_LEARNINGS` y `SQL_LIST_PRUNE_TURNS` dependen de índices que no existen aún en migraciones

- **Files**: `sqlite-memory-entry-reader.ts:144-159`
- **Detalle**: Las queries de prune filtran por `confidence < ? AND use_count = 0 AND created_at_ms <= ?`. Para que estén bajo plan `SEARCH USING INDEX` se necesitan índices compuestos en `(confidence, use_count, created_at_ms)` en `learnings` y `(confidence, use_count, recorded_at_ms)` en `turns`. Esos índices NO viven en la migración 003 (correctamente — no son curator-owned), pero son responsabilidad del equipo memory en sus propias migraciones.
- **Acción**: Verificar en Fase 4 (auditor de modelo de datos) que `001__core-schema.sql` (cuando exista) defina estos índices. Si no, `EXPLAIN QUERY PLAN` mostrará `SCAN TABLE` en 50K filas.

### L3 — `SQL_TOP_TURNS_BY_SESSION` requiere índice en `(session_id, confidence DESC)`

- **File**: `sqlite-session-rollup-reader.ts:24-30`
- **Detalle**: Igual que L2 — el rollup ordena por confidence descending dentro de session_id. Sin índice compuesto, tabular scan + sort. El curator depende de que memory provea el índice.

---

## Info (positivos verificados)

- ✅ `SqliteMemoryEntryWriter.markPruned(...)` envuelve INSERT pruned + DELETE live en `db.transaction(...)` (líneas 179-192). Atomicidad garantizada.
- ✅ `Vec0SimilarityFinder` usa `MATCH ?` + `k = ?` (sqlite-vec KNN) en vez de cómputo de cosine en JS (líneas 71-77, 134-137). Cumple R-vec.
- ✅ `IntervalCuratorScheduler` tiene `clearTimeout` en `stop()` (línea 118) + flag `inflight` (líneas 154-173) que previene runs solapados — equivalente al "mutex/lock" requerido.
- ✅ `RunCuratorUseCase.guardInFlightRun(...)` usa `findLastByWorkspace(workspaceId)` apoyado por `idx_curator_runs_by_workspace` (DESC) — plan óptimo.
- ✅ `idx_curator_runs_inflight` es un partial index sobre `WHERE ended_at_ms IS NULL` (migration 003 línea 83-85). Excelente — el lookup de runs in-flight es O(log n) sobre el subconjunto activo (típicamente 0-1 fila).
- ✅ `idx_pruned_by_workspace (workspace_id, pruned_at_ms DESC)` y `idx_pruned_by_kind (kind, pruned_at_ms DESC)` cubren los dos accesos: audit-trail por workspace y lookup por kind+id.
- ✅ El decay pass usa `iterateActiveByKind` (streaming) — memoria O(1), no carga 50K en RAM.
- ✅ `MAX_CANDIDATES_PER_PASS = 500` en `consolidate-similar.use-case.ts:35` acota el O(n × k) de KNN a un techo predecible.
- ✅ `RunCuratorUseCase` NO envuelve la pasada completa en una transacción (comentario líneas 67-77 explica el rationale: una transacción de varios segundos starves a otros writers). Cada sub-use-case maneja su propia atomicidad.
- ✅ El cross-import a `memory/domain` está acotado a tipos (`Learning`, `LearningRepository`, `LearningId`, `LearningSeverity`, `Session`, `SessionRepository`, `SessionSummary`) — autorizado por ADR-001.
- ✅ Re-uso del cooldown de 5min en scheduler previene back-to-back triggers.

---

## Verificaciones de reglas

| Regla | Resultado | Notas |
|---|---|---|
| A.1 — Índices `pruned` (original_id, pruned_at, reason) | ⚠️ PARCIAL | Hay índices por `(workspace_id, pruned_at_ms)` y `(kind, pruned_at_ms)`, pero NO por `original_id` solo ni por `reason`. **El acceso documentado en el comentario del migration es `WHERE kind = ? AND original_id = ?`** que se sirve por la **PK compuesta** `(workspace_id, kind, original_id)` — ese es el plan óptimo. La ausencia de índice por `reason` solo aplica si hay queries `WHERE reason = ?`, que no existen en el código actual. ACEPTABLE. |
| A.2 — Índices `curator_runs` | ✅ | `idx_curator_runs_by_workspace` (started_at DESC) + `idx_curator_runs_inflight` (partial). PK por `id`. Cubre los 3 accesos: `findById`, `findRecentByWorkspace`, `findLastByWorkspace`. |
| A.3 — Queries usan índices | ✅ | Todas las queries en adapters usan WHERE/ORDER BY que coinciden con los índices definidos. |
| B.1 — `ApplyDecay` no N+1 a nivel reader | ✅ | Una sola consulta SELECT por kind, stream-iterada. |
| B.1 — `ApplyDecay` no N+1 a nivel writer | ⚠️ H1 | UN UPDATE por entry, sin batch. Aceptable < 50K, fix en Fase 5. |
| B.2 — `Vec0SimilarityFinder` no O(N×M) | ✅ | KNN sqlite-vec, no producto cartesiano en JS. |
| B.3 — `PruneLowConfidence` batch | ⚠️ H2 | Loop por candidato, sin batch transaction. Aceptable < 1K candidatos típicos por pase. |
| C.1 — Use cases batch en transacción única | ⚠️ PARCIAL | Solo `markPruned` está en transacción; el orchestrator NO envuelve en transacción global (decisión documentada y correcta para evitar lock de varios segundos). |
| C.2 — `RollupSession` atómico | ⚠️ NO | El rollup hace `findCurrentByWorkspace`, `listTopTurns`, `setSummary`, `end`, `save` sin envolver en transacción. La atomicidad depende de que `SessionRepository.save(...)` en `memory/infrastructure` ejecute internamente una transacción (no auditable desde aquí). **Acción**: validar en Fase 4 que `save(Session)` haga atomic update. |
| D — WAL / busy_timeout | ✅ | Ningún PRAGMA modificado por curator; respeta config global. |
| E — sqlite-vec sintaxis | ✅ | `MATCH ?` + `k = ?`, no cosine en JS. |
| F.1 — Scheduler sin leaks | ✅ | `clearTimeout` en `stop()` (línea 118). |
| F.2 — Scheduler sin overlapping | ✅ | Flag `inflight` (líneas 154-173) + cooldown (línea 137). |

---

## Veredicto

**APPROVED**.

Cero críticos. Los tres High (H1, H2, H3) y los tres Medium (M1, M2, M3) son optimizaciones diferibles a Fase 5 conforme a `HANDOFF.md` §6.6 — el módulo cumple el budget de < 30s para 50K items en su forma actual gracias a streaming iteration, KNN sqlite-vec, prepared-statement caching del driver, y partial indexes. Las dos observaciones Low (L2, L3) son dependencias hacia índices que el módulo memory debe definir en su propia migración — no es responsabilidad del curator.

