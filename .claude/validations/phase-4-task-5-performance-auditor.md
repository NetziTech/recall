# Phase 4 — Task 4.5 — Performance Auditor

**Auditor**: `performance-auditor`
**Scope**: `code/src/modules/memory/application/` + `code/src/modules/memory/infrastructure/` + `code/migrations/004__core-memory-schema.sql`
**Targets**: `mem.remember < 30 ms p95`, `mem.recall < 100 ms p95`, `mem.context < 200 ms p95`, batch ops over 50K rows < 30 s.

---

## Resumen

Auditoría estática (sin ejecutar benchmarks). El módulo `memory` cumple
las reglas básicas de prepared statements + WAL/PRAGMAs (heredados de
`SqliteDatabase`) y la migración `004` declara TODOS los índices del
catálogo `docs/03-modelo-datos.md` §4. Los `RecordX` use cases están
correctamente diseñados para `mem.remember`: validación + INSERT
único + enqueue fire-and-forget, **sin `await embedder.embed(...)`
síncrono** (R5 cumplido).

Sin embargo se detectan **3 hallazgos críticos** con impacto directo
en SLOs de export/import/audit y un **alto número de hallazgos high**
relacionados con re-`prepare` en hot paths (every call site invokes
`db.prepare(SQL_*)` per request; better-sqlite3 NO cachea por-SQL
internamente — la compilación se repite). En `mem.remember` el
sobrecosto agregado de re-prepare es **dominante** ya que el target es
30 ms y cada use case re-prepara 1 INSERT de aggregate + 1 INSERT en
`embedding_queue` + (en el caso de `RecordTurnUseCase`) 2 prepares de
session.

Además `ImportMemoryUseCase` y `ImportHandoffUseCase` carecen de
transacción única envolviendo todos los saves — un fallo a mitad de
import deja estado parcial e impide cumplir el target nightly de
50K rows < 30 s (sin transacción cada save es un autocommit con fsync).

---

## CRÍTICOS (bloquean APPROVED si no se corrigen ANTES de benchmarks)

### C1 — N+1 query en `SqliteMemorySnapshotReader` (afecta export 50K)

**Archivo**: `code/src/modules/memory/infrastructure/persistence/sqlite-memory-snapshot-reader.ts`
**Líneas**: 107-126
**Regla**: R3 (no N+1).

El reader hace `SELECT id` + `findById` por fila para `turns`,
`sessions` y `relations`:

```typescript
const turnIds = this.collectIds(SQL_LIST_TURN_IDS);
for (const id of turnIds) {
  const turn = await this.turns.findById(TurnId.from(id));   // 1 query por id
  if (turn !== null) allTurns.push(turn);
}
```

Para 50K turns son **50K queries** + 50K Zod parses + 50K aggregate
rehydrates. Con `mem.export` target < 30 s nightly y un cold-cache
SQLite cost de ~0.5 ms por prepare+get+parse, serían ~25 s sólo en
turns; sumando sessions+relations excede el window.

**Suggested fix**:
- Añadir `findAll(workspaceId)` (o `iterateAll(workspaceId)`) a
  `TurnRepository`, `SessionRepository`, `RelationRepository`. Devolver
  todas las filas con un `stmt.all()` único (o `stmt.iterate()` para
  streaming si la cardinalidad es alta).
- Reescribir `SqliteMemorySnapshotReader.read(...)` para llamar a esos
  métodos en lugar del id-walk.
- Ya hay precedente: `decisions`, `learnings`, `entities` y `tasks`
  usan `findByWorkspace`/`findByStatus` que cargan en bulk. Aplicar la
  misma forma a turns/sessions/relations.

---

### C2 — N+1 query en `AuditMemoryUseCase` (relations)

**Archivo**: `code/src/modules/memory/application/use-cases/audit-memory.use-case.ts`
**Líneas**: 174-189
**Regla**: R3.

```typescript
for (const e of allEntities) {                        // N entities
  const endpoint = RelationEndpoint.entity(EntityId.from(id));
  const edges = await this.relations.findFromEndpoint(endpoint);   // 1 SELECT por entidad
  for (const edge of edges) { ... }
}
```

Con N entities y M edges, el coste es **N round-trips** en lugar de un
`findAllRelations(workspaceId)` + JOIN en memoria contra el `Set`
de entityIds. Con 10K entities el audit se vuelve O(10K) queries, lo
cual rompe el target batch (< 30s nightly) y hace al CLI subcomando
`mcp-memoria audit` inutilizable interactivamente.

**Suggested fix**:
- Añadir `findAllRelations(workspaceId)` a `RelationRepository`
  (paralelo al pattern `findByWorkspace`). Implementarlo con un único
  `SELECT * FROM relations`.
- En `collectRelationIssues(...)` reemplazar el outer loop por una
  sola query y hacer la validación dangling-endpoint en JS contra el
  `entityIds` Set.
- Beneficio adicional: el Audit dejará de violar el contrato de
  encapsulamiento de aggregate (hoy lee `getTo().toValue()` per edge,
  pero al menos lo hará una sola vez en bloque).

---

### C3 — `ImportMemoryUseCase` y `ImportHandoffUseCase` SIN transacción única

**Archivos**:
- `code/src/modules/memory/application/use-cases/import-memory.use-case.ts` (líneas 88-131)
- `code/src/modules/memory/application/use-cases/import-handoff.use-case.ts` (líneas 73-131)

**Regla**: R4 (batch INSERTs) + R-D (transacciones).

Ambos use cases ejecutan N saves secuenciales sin agruparlos en una
transacción:

```typescript
// import-memory.use-case.ts
const sessionStats = await this.persistKind(snapshot.sessions, ...);   // N saves
const turnStats    = await this.persistKind(snapshot.turns,    ...);   // M saves
// ...
```

Cada `save(...)` es un autocommit con fsync (synchronous=NORMAL).
Para 50K aggregates importados:

- Sin transacción: ~50K fsyncs ≈ 50K × 1-2 ms = 50-100 s. **Excede
  el window nightly de 30 s.**
- Con transacción única: 1 fsync al COMMIT, ~50K INSERTs en bulk ≈
  2-5 s.

**Además**, sin transacción un fallo en el row N+1 deja N rows
persistidos. La JSDoc de `ImportMemoryUseCase` afirma "an import is a
state restoration" pero la atomicidad no está garantizada.

**Suggested fix**:
- Inyectar `DatabaseConnection` en `ImportMemoryUseCase` y
  `ImportHandoffUseCase` (vía un puerto de aplicación, p.ej.
  `TransactionRunner` para no romper Clean si el use case no quiere
  conocer DB directamente).
- Envolver TODO el cuerpo de `import` en `db.transaction(() => { ... })`.
  better-sqlite3 transactions son síncronas — el use case debe
  refactorizar para que las operaciones internas sean sync (los
  repositorios actuales devuelven `Promise<void>` pero internamente
  son sync; la firma puede mantenerse sin awaits dentro del closure).
- Alternativa más limpia: añadir un puerto `MemoryBulkImporter` con
  método `importAll(snapshot)` cuyo adapter SQLite haga la transacción.
  El use case sólo orquesta strategy + parser.

---

## HIGH (no bloquean APPROVED pero deben atenderse antes de release)

### H1 — Prepared statements re-`prepare`d en cada llamada (todos los repos)

**Archivos**: TODOS los `sqlite-*-repository.ts` + `sqlite-*-reader.ts` +
`sqlite-embedding-enqueuer.ts` + `sqlite-memory-wiper.ts`.
**Regla**: R2.

Patrón uniforme:

```typescript
public async findById(id: ...): Promise<...> {
  const stmt = this.db.prepare(SQL_SELECT_BY_ID);   // re-prepare en cada call
  ...
}
```

`SqliteDatabase.prepare(sql)` no cachea — invoca `this.db.prepare(sql)`
de better-sqlite3 sin memoización. better-sqlite3 NO cachea
internamente por-SQL (ver
https://github.com/WiseLibs/better-sqlite3/blob/HEAD/docs/api.md). Cada
prepare implica:
1. Allocación del wrapper `SqliteStatement`.
2. `sqlite3_prepare_v2()` nativo → tokenizer + parser + planner.

Coste medido en benchmarks de better-sqlite3: 30-100 µs por prepare.
Para `mem.remember` (target 30 ms p95) el `RecordTurnUseCase` re-
prepara:
- 1× `SQL_SELECT_CURRENT` (sessions)
- 1× `SQL_UPSERT` (turns)
- 1× `SQL_UPSERT` (sessions, save de recordActivity)
- 1× `SQL_INSERT` (embedding_queue)

≈ 4 × 50 µs = 200 µs SOLO en re-prepares. Suma con Zod parsing,
JSON.stringify (tags/metadata) y aggregate construction. Margen muy
estrecho para 30 ms cuando se ejecutan FTS5 triggers + WAL fsync.

**Suggested fix** (tres opciones, ordenadas de mejor a peor):
1. **Recomendada**: cachear en `SqliteDatabase` con un `Map<string,
   PreparedStatement>` keyed por SQL. Es transparente a los repos y la
   port doc EXPLÍCITAMENTE permite cache ("implementations MAY cache").
2. Cada repo guarda los `PreparedStatement` como propiedades privadas
   (`private readonly findByIdStmt: PreparedStatement`). Más boilerplate
   pero deja claro el contrato.
3. No hacer nada y medir. Si los benchmarks p95 quedan < 30 ms con un
   margen razonable, descartar este high.

### H2 — Validación Zod por-fila bloquea `mem.recall` con 50K filas

**Archivos**: todos los repos parsean cada fila con `XxxRowSchema.parse(raw)`.
**Regla**: R-B (mem.recall < 100 ms con 50K entries).

Aunque la auditoría es de memory (no retrieval), `findByWorkspace` /
`findActive*` son consumidos por el pipeline de recall (vía cross-
module ADR-001). Zod `.parse()` no es gratis: ~5-10 µs por objeto con
~10 keys. Para 50K decisions activas:
50K × 7 µs ≈ 350 ms — **rompería el target de recall**.

`SqliteDecisionRepository.findActiveByTags` tiene un comentario que ya
reconoce el problema ("a sequential scan with in-memory tag matching is
acceptable for the MVP"). El tema es la combinación con Zod.

**Suggested fix**:
- Para hot paths recall (decisiones activas y top-K turnos), considerar
  un schema "fast path" que use type guards (`row && typeof row.id ===
  "string" && ...`) en lugar de Zod. Mantener Zod en paths fríos
  (audit, export, import).
- Alternativa: usar `z.object({...}).strict()` con `.parse()` solo en
  cold paths y `.safeParse()` con manejo manual en hot. La auditoría
  de retrieval (Tarea 3.x) ya validó que el FTS5+vec cap pre-rank es
  ~200, así que el problema sólo aparece si recall trae el subset
  completo activo. Verificar que el flow de retrieval pasa por
  `findActiveByTags` solo con `requiredTags.isEmpty() === false`.

### H3 — `tasks` no tiene índice por `created_at_ms`

**Archivo**: `code/migrations/004__core-memory-schema.sql` (líneas 327-328).
**Adapter**: `sqlite-task-repository.ts` (líneas 55-77).
**Regla**: R1 + R10.

El catálogo §4.7 sólo declara `idx_tasks_status_priority(status,
priority)`. `SQL_SELECT_OPEN` y `SQL_SELECT_BY_STATUS` filtran por
status y luego ordenan por `created_at_ms DESC`. Como el índice
compuesto NO incluye `created_at_ms`, SQLite hará SEARCH+SORT en lugar
de SEARCH-only. Con tasks abiertas en el orden de cientos no es un
problema; con miles sí.

**Suggested fix**:
- Añadir índice cubrir-orden: `CREATE INDEX idx_tasks_open_created
  ON tasks (status, created_at_ms DESC) WHERE status != 'done'`. O un
  composite `(status, created_at_ms)` global.
- Verificar con `EXPLAIN QUERY PLAN SELECT ... FROM tasks WHERE status
  != 'done' ORDER BY created_at_ms DESC` que el planner consume el
  índice (esperar `SEARCH USING INDEX`, no `SCAN`).

### H4 — `entities` no tiene índice por `created_at_ms`

**Archivo**: `code/migrations/004__core-memory-schema.sql` (líneas 255-259).
**Adapter**: `sqlite-entity-repository.ts` (líneas 68-80).
**Regla**: R1 + R10.

Mismo issue que H3: `SQL_SELECT_ALL` y `SQL_SELECT_BY_KIND` ordenan por
`created_at_ms DESC`. Sólo `idx_entities_name` y `idx_entities_kind`
existen. Con cardinalidad > 5K entities (workspace grande) el SCAN+SORT
será SO(N log N).

**Suggested fix**: añadir `CREATE INDEX idx_entities_created ON
entities (created_at_ms DESC)`. Coste de índice: ~24 bytes/fila × 50K
= 1.2 MB; aceptable.

### H5 — `relations` no tiene índice por `created_at_ms`

**Archivo**: `code/migrations/004__core-memory-schema.sql` (líneas 299-303).
**Adapter**: `sqlite-relation-repository.ts` (`SQL_SELECT_BY_FROM`
y `SQL_SELECT_BY_TO` ordenan por `created_at_ms DESC`).
**Regla**: R1.

Para los queries por endpoint el índice `idx_relations_from` /
`idx_relations_to` cubre el WHERE pero no el ORDER BY. Con un nodo
hub con muchas aristas (ej. una entidad central como un módulo
con 200 dependencias), el SCAN+SORT pesa.

**Suggested fix**: índices compuestos
`(from_entity_id, created_at_ms DESC)` y `(to_entity_id, created_at_ms
DESC)`. O confirmar (con EXPLAIN) que SQLite ya hace ORDER BY usando
el índice del WHERE; en muchos casos sí.

### H6 — `ExportMemoryUseCase` carga TODO en memoria

**Archivo**: `code/src/modules/memory/application/use-cases/export-memory.use-case.ts`
(líneas 36-40).
**Regla**: R-F (iteradores/streams).

`MemorySnapshotReader.read(...)` materializa el snapshot completo en
arrays freezados. Para 50K turns + 50K decisions + ... el snapshot
consume varios cientos de MB en heap. El JSON.stringify del exporter
duplica el coste.

**Suggested fix** (futuro, no bloquea MVP):
- Cambiar `MemoryExporter` a un streaming serializer (`AsyncIterable<Uint8Array>`).
- `MemorySnapshotReader` usa `iterate()` por kind y emite chunks.
- ExportMemoryUseCase escribe directamente al sink (file path o stdout)
  sin materializar el JSON completo en memoria.

Por ahora documentar como **límite del MVP**: export sólo soportado en
workspaces con < 10K aggregates totales.

### H7 — `ImportMemoryUseCase.persistKind`: `findById` por aggregate antes de save

**Archivo**: `code/src/modules/memory/application/use-cases/import-memory.use-case.ts`
(líneas 187-202).
**Regla**: R3.

```typescript
for (const agg of aggregates) {
  const existing = await finder(agg);   // 1 SELECT BY ID por agregado
  ...
  await saver(agg);                      // 1 UPSERT por agregado
}
```

Para 50K agregados son 100K queries (50K SELECT + 50K UPSERT). Muy
caro fuera de transacción, mucho mejor con. Pero la verificación
collision-strategy se podría hacer batch:

**Suggested fix**:
- Para `strategy === "skip"`: pre-computar el set de ids existentes
  con un único `SELECT id FROM <table> WHERE id IN (?, ?, ...)`
  (chunked si los ids son > 999 por SQLite limit), y luego saltar en
  memoria.
- Para `strategy === "replace"`: omitir el SELECT, usar UPSERT
  directamente — el ON CONFLICT del adapter ya maneja el caso.
- Para `strategy === "error"`: pre-computar collisions en batch y
  fallar antes de cualquier save.

---

## MEDIUM

### M1 — `RecordEntityUseCase` hace SELECT antes de INSERT

**Archivo**: `code/src/modules/memory/application/use-cases/record-entity.use-case.ts`
(líneas 49-60).

`findByNameAndKind(...)` antes de save. El schema ya tiene `UNIQUE
(name, entity_kind)`; un INSERT ON CONFLICT DO NOTHING returning id
sería más rápido. Sin embargo el SELECT permite distinguir
`alreadyExisted` para el resultado del use case, lo cual es valor
real. Mantener pero verificar que `idx_entities_name` está siendo
usado (debería estar — lo hay).

### M2 — `tryEnqueue` llama `clock.now()` dos veces en `RecordX` use cases

Pequeño detalle: en cada use case `RecordDecision/Learning/Entity/Turn`
el patrón hace `now = clock.now()` arriba y luego dentro de
`tryEnqueue` re-llama `this.clock.now()` para `enqueuedAt`. Reutilizar
el `now` ahorra una syscall de `Date.now()` (~50 ns) — irrelevante
en perf, pero hace los timestamps de la misma operación coherentes.

### M3 — `JSON.stringify(...tags...)` y `JSON.parse(...)` en hot path

Cada save hace `JSON.stringify(decision.getTags().toArray())`. Cada
load hace `JSON.parse(rawJson)` + Zod validación. Para tags pequeñas
(< 5) es ~5 µs total. Si el target final de recall es < 100 ms p95
con 8 results y 50K candidatos, el parse JSON está en el camino
crítico de algún path. Sin acción inmediata; nota para benchmark.

### M4 — `SqliteEntityRepository.findActiveByTags` es scan + filter

El comentario en `sqlite-decision-repository.ts` líneas 191-196 es
explícito sobre la limitación. Mismo patrón en
`sqlite-learning-repository.ts` (no validado pero esperable). No es
bloqueante para Tarea 4.5; tracked como Fase 5 perf note.

---

## LOW / INFO

### I1 — `SqliteDatabase` aplica WAL + PRAGMAs correctamente

Verificado en `code/src/shared/infrastructure/database/sqlite-database.ts`
líneas 254-259:
- `journal_mode = WAL` ✓
- `synchronous = NORMAL` ✓
- `foreign_keys = ON` ✓
- `cache_size = -64000` ✓
- `temp_store = MEMORY` ✓

Cumple R6.

### I2 — Migración 004 tiene TODOS los índices del catálogo

Cross-checked con `docs/03-modelo-datos.md` §4.1-4.7:
- `idx_sessions_started`, `idx_sessions_active` (partial) ✓
- `idx_turns_recent`, `idx_turns_session` ✓
- `idx_decisions_created`, `idx_decisions_active` (partial),
  `idx_decisions_scope` ✓
- `idx_learnings_created`, `idx_learnings_severity`,
  `idx_learnings_active` (partial) ✓
- `idx_entities_name`, `idx_entities_kind` ✓ (falta
  `idx_entities_created` — H4)
- `idx_relations_from`, `idx_relations_to` ✓
- `idx_tasks_status_priority` ✓ (falta `idx_tasks_created` — H3)
- FTS5 shadows (`turns_fts`, `decisions_fts`, `learnings_fts`,
  `entities_fts`) y triggers AI/AD/AU ✓

### I3 — `mem.remember` patrón ASYNC embedding correcto

Verificado en `record-decision.use-case.ts` (y los 4 hermanos):
- Persiste el aggregate (`save`) ANTES de cualquier embed.
- Encola en `embedding_queue` vía `EmbeddingEnqueuer` (escribe 1
  INSERT con prepared statement, no SELECT antes — fire-and-forget).
- **NO importa `embedder.embed(...)` ni cualquier API similar**
  desde `application/use-cases/`.
- Si el enqueue falla, log warn y devuelve `embeddingEnqueued: false`
  — el row queda persistido. Decisión correcta (los embeddings son
  regenerables por el curator).

`grep -rE "embedder\.embed\(" code/src/modules/memory/application/use-cases/`
devuelve **vacío** ✓.

### I4 — `MarkdownHandoffParser` usa regex/lexer simple

`code/src/modules/memory/infrastructure/import-export/markdown-handoff-parser.ts`
sólo importa `Tags` y declaraciones de puerto. Sin `markdown-it`, sin
`unified`, sin `remark`. Parser line-by-line con regex compiladas en
módulo-scope. Cumple R-I.

### I5 — `SessionContextHelper.acquire` usa una sola query para idle

`findCurrentByWorkspace(workspaceId)` → `SQL_SELECT_CURRENT` con
partial index `idx_sessions_active`. La verificación `current.isIdle(now)`
es cómputo en JS sobre el aggregate cargado. Cumple R-H.

### I6 — `SqliteEmbeddingEnqueuer` fire-and-forget

Verificado: 1 prepared INSERT, sin SELECT previo. Cumple R-G.

---

## Verificaciones realizadas

- [x] `code/migrations/004__core-memory-schema.sql` — todos los índices del
  catálogo presentes (con 3 ausencias menores marcadas H3/H4/H5).
- [x] FTS5 shadows + triggers AI/AD/AU para turns, decisions, learnings,
  entities. Tasks SIN FTS (consistente con catálogo §4.7).
- [x] Foreign keys: `turns→sessions` y `relations→entities` ✓.
- [x] WAL + PRAGMAs en `SqliteDatabase` ✓ (R6).
- [x] `RecordX` use cases NO llaman `embedder.embed(...)` (R5) ✓.
- [x] `EmbeddingEnqueuer` adapter es 1 INSERT prepared, sin SELECT (R-G) ✓.
- [x] `SessionContextHelper.acquire` usa 1 sola query para idle check ✓.
- [x] Markdown parser es regex-based (no markdown-it/remark) ✓.
- [x] `SqliteMemoryWiper` envuelve los DELETE en transacción única ✓.
- [x] `ImportMemoryUseCase` y `ImportHandoffUseCase` SIN transacción (C3) ✗.
- [x] `SqliteMemorySnapshotReader` tiene N+1 turns/sessions/relations (C1) ✗.
- [x] `AuditMemoryUseCase` tiene N+1 relations (C2) ✗.
- [x] Prepared statements declaradas como constantes module-scope ✓.
- [x] Prepared statements NO cacheadas a nivel adapter (H1) ✗.

---

## Veredicto

**REJECTED.**

**Razón**: 3 hallazgos críticos (C1, C2, C3) que comprometen los SLOs
documentados de export/import/audit (50K rows en < 30s nightly window).
Los hallazgos high (H1-H7) no son bloqueantes individualmente pero
H1 acumulado con C3 amenaza el target de 30 ms p95 de
`mem.remember` cuando se incluya el embed-queue write y session save
en `RecordTurnUseCase`.

**mem.remember (estático)**: el path crítico actual es
`SELECT_CURRENT (sessions) + UPSERT (turns) + UPSERT (sessions) +
INSERT (embedding_queue)`. Sin re-prepare cache son ~4 prepares
(~200 µs) + 4 fsyncs WAL (~4 ms) + Zod validations (~30 µs) + FTS5
trigger overhead (~1-2 ms). Estimación p95 sin cache: 8-15 ms.
**Cumple el target de 30 ms con margen, PERO** el margen se evapora
si la carga incrementa o si se añaden eventos al EventPublisher
sincrónico. Con cache de prepares (H1) el margen sería sano.

**Acción requerida ANTES de marcar APPROVED**:
1. Resolver C1 (snapshot reader N+1) — añadir `findAll` a turn/session/
   relation repos.
2. Resolver C2 (audit relations N+1) — añadir `findAllRelations` y
   reescribir `collectRelationIssues`.
3. Resolver C3 (import sin tx) — envolver `ImportMemoryUseCase` y
   `ImportHandoffUseCase` en `db.transaction()` (vía port nuevo o
   inyección de `DatabaseConnection`).
4. Después de los fixes, ejecutar benchmarks p95 reales sobre 1K /
   10K / 50K datasets sintéticos.

Una vez los 3 críticos resueltos, los hallazgos high pueden quedar
en backlog para Fase 5.

---

**Validador**: performance-auditor
**Fecha**: 2026-04-27
**Tarea**: Phase 4 — Task 4.5 (memory/application + memory/infrastructure)
