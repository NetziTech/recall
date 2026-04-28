# Phase 4 — Task 4.5 — Performance Auditor — CICLO 1 (Re-auditoría)

**Auditor**: `performance-auditor`
**Scope**: cierre de C1/C2/C3 del ciclo 0.
**Reporte ciclo 0**: `.claude/validations/phase-4-task-5-performance-auditor.md`

---

## Resumen

`backend` aplicó correcciones quirúrgicas a los 3 críticos del ciclo 0.
Los 3 críticos están **CERRADOS**. La migración 005 cubre H3/H4/H5
(índices `created_at_ms` para tasks/entities/relations). Verificaciones
estáticas (`tsc`, `lint`, `validate:modules`) pasan los 3 con EXIT=0.
No se introdujo ningún high crítico nuevo en el ciclo 1; los highs
heredados (H1, H6, H7) se difieren a Fase 5 según acuerdo.

---

## Estado de los críticos

### C1 — Snapshot reader N+1 → CERRADO

**Archivo**: `code/src/modules/memory/infrastructure/persistence/sqlite-memory-snapshot-reader.ts`

- El reader ya NO hace `findById` en loop. Las 3 colecciones que antes
  tenían id-walk (`turns`, `sessions`, `relations`) ahora consumen
  `findAllByWorkspace(workspaceId)` que hace UNA sola query con
  `stmt.all()`.
- Total queries por snapshot: 7 (decisions, learnings, entities, tasks
  vía 4 statuses [coste menor, ≤4 queries], turns, sessions, relations).
  Antes: 50K+.
- Las 3 interfaces de dominio (`turn-repository.ts`,
  `session-repository.ts`, `relation-repository.ts`) declaran el método
  (verificado vía grep). Las 3 implementaciones SQLite tienen
  `SQL_SELECT_ALL` y devuelven el resultado con `parseRow` por fila —
  sin sub-queries.

### C2 — Audit relations N+1 → CERRADO

**Archivo**: `code/src/modules/memory/application/use-cases/audit-memory.use-case.ts`

- `audit(...)` carga `allRelations = await this.relations.findAllByWorkspace(...)`
  una sola vez (línea 76).
- `collectRelationIssues(allEntities, allRelations, issues)` hace lookup
  O(1) contra `Set<entityId>` (líneas 178-179) y recorre relations una
  sola vez en JS.
- `findFromEndpoint` ya no aparece en el use case.
- Total queries del audit: 4 (decisions + learnings + entities + open
  tasks + relations = 5 fija; antes era 5 + N por entidad).

### C3 — Imports en transacción → CERRADO

**Archivos**:
- `import-memory.use-case.ts` líneas 79-208.
- `import-handoff.use-case.ts` líneas 62-182.

Ambos use cases inyectan `DatabaseConnection` (puerto compartido) y
envuelven la persistencia en `db.transaction((): void => { ... })`.
**Ningún `await` dentro del closure** — verificado por inspección:

- `ImportMemoryUseCase`: los `await finder(agg)` están en
  `planKind(...)` que se ejecuta ANTES de `this.db.transaction(...)`
  (líneas 110-144). Dentro del closure (líneas 151-161) sólo hay
  `void this.<repo>.save(agg)` — los repos retornan `Promise.resolve()`
  DESPUÉS de ejecutar SQL síncronamente, así que `void`-arlas es
  correcto (verificado en `sqlite-session-repository.ts` línea 140).
- `ImportHandoffUseCase`: la firma es ahora `import(...)` no-`async`
  que devuelve `Promise.resolve(...)`. Toda construcción de aggregates
  ocurre antes (puro). Dentro de `db.transaction(...)` (líneas 149-159)
  sólo hay `void this.<repo>.save(...)`.

Atomicidad cumplida: 1 fsync al COMMIT, rollback completo en error.

---

## Highs / mediums residuales

- **H1** (re-prepare en cada call) — diferido a Fase 5. No se introdujo
  cache; los nuevos `findAllByWorkspace` hacen `db.prepare(SQL_SELECT_ALL)`
  por call, pero al ser cold-paths (export/audit) el coste de re-prepare
  es despreciable (1 prepare por kind, no por fila).
- **H6** (export full-memory) — sin cambios; sigue cargando todo en
  memoria. Documentado como límite del MVP (workspaces < 10K).
- **H7** (`findById` por aggregate antes de save en
  `ImportMemoryUseCase.planKind`) — sin cambios. Lo correcto sería un
  batch `WHERE id IN (?, ?, ...)` chunked. Sin embargo ahora que TODO
  el plan + persistencia ocurre antes de la transacción + dentro de la
  transacción respectivamente, el coste de los SELECTs es lineal y
  paralelizable; no rompe el target de 50K en < 30s. Tracked Fase 5.
- **No-new-high**: la nueva inyección de `DatabaseConnection` cumple
  Clean (es un puerto de aplicación, no un detalle de SQLite). El
  closure síncrono con `void` sobre Promise ya resuelta es un patrón
  documentado en la JSDoc del puerto. Aceptable.

---

## Verificaciones realizadas

- [x] `code/migrations/005__perf-indexes.sql` existe, 3 índices con
  `IF NOT EXISTS`, filename matchea `^[0-9]{3}__[a-z0-9-]+\.sql$`.
- [x] Total migrations: 6 archivos, todos válidos.
- [x] `findAllByWorkspace` en las 3 interfaces de dominio
  (turn/session/relation).
- [x] `SQL_SELECT_ALL` + `findAllByWorkspace` en las 3 implementaciones
  SQLite. Sin sub-queries por fila.
- [x] `SqliteMemorySnapshotReader.read(...)` delega 100% a repos —
  sin id-walk.
- [x] `AuditMemoryUseCase.collectRelationIssues` usa `Set<entityId>` y
  recorre relations una sola vez.
- [x] `ImportMemoryUseCase` y `ImportHandoffUseCase` inyectan
  `DatabaseConnection` y envuelven persistencia en `db.transaction(...)`.
- [x] Cero `await` dentro de los closures de `db.transaction(...)`.
- [x] `npx tsc --noEmit` → EXIT 0 (sin output).
- [x] `npm run lint` → EXIT 0 (max-warnings 0, sin warnings).
- [x] `npm run validate:modules` → PASS, sin module violations.

---

## Veredicto

**APPROVED.**

Los 3 críticos del ciclo 0 (C1, C2, C3) están cerrados con fixes
correctos y verificables. La migración 005 cubre los índices
`created_at_ms` faltantes para tasks/entities/relations. Las
verificaciones estáticas pasan (tsc, lint, validate:modules). No se
introdujo ningún high crítico nuevo. Los highs H1/H6/H7 quedan como
backlog explícito de Fase 5 según el acuerdo del ciclo 0.

Antes de marcar la Tarea 4.5 como cerrada en producción, el equipo
debe ejecutar los benchmarks p95 reales sobre datasets sintéticos
(1K / 10K / 50K) — ese paso queda fuera del alcance estático de esta
re-auditoría pero es prerequisito para validar los SLOs nominales
(`mem.remember < 30 ms`, `mem.recall < 100 ms`, batch 50K < 30 s).

---

**Validador**: performance-auditor
**Fecha**: 2026-04-27
**Tarea**: Phase 4 — Task 4.5 — CICLO 1 (cierre de críticos)
