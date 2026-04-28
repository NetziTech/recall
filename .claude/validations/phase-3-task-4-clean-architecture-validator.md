# Phase 3 Task 4 — clean-architecture-validator

**Cycle:** 0
**Verdict:** APPROVED
**Date:** 2026-04-27

**Scope**: `code/src/modules/curator/application/` + `code/src/modules/curator/infrastructure/` + `code/migrations/003__pruned-and-curator-runs.sql`.

## 1. Resumen ejecutivo

`npm run validate:modules` reporta `[OK] curator (authorised cross-imports: memory×10) ... Result: PASS — no module violations`. Cero violaciones críticas. Cero no críticas.

## 2. Críticos
**Ninguno.**

## 3. No críticos
**Ninguno.**

## 4. Verificaciones

### A. Dirección de dependencias
- A.1 `application/` → `infrastructure/`: 0 hits. **OK.**
- A.2 Use cases inyectan puertos por constructor (`RunCuratorUseCase`: 9 puertos; `ConsolidateSimilarUseCase`: 6; `ApplyDecayUseCase`: 4). Cero `new SqliteX|Vec0X|NodeX|IntervalX` en `application/`. Solo `new Map`/`new Set` (stdlib) en `consolidate-similar.use-case.ts:107,131`. **OK.**

### B. ADR-001 (CRÍTICO) — los 10 cross-imports

| # | Origen | Destino |
|---|--------|---------|
| 1 | `application/use-cases/rollup-session.use-case.ts:4` | `memory/domain/repositories/session-repository.ts` |
| 2 | `application/use-cases/rollup-session.use-case.ts:5` | `memory/domain/value-objects/session-summary.ts` |
| 3 | `application/use-cases/consolidate-similar.use-case.ts:4` | `memory/domain/repositories/learning-repository.ts` |
| 4 | `application/use-cases/consolidate-similar.use-case.ts:5` | `memory/domain/aggregates/learning.ts` |
| 5 | `application/use-cases/consolidate-similar.use-case.ts:6` | `memory/domain/value-objects/learning-id.ts` |
| 6 | `application/ports/out/memory-entry-reader.port.ts:4` | `memory/domain/value-objects/learning-severity.ts` |
| 7 | `infrastructure/persistence/sqlite-memory-entry-reader.ts:10` | `memory/domain/value-objects/learning-severity.ts` |
| 8 | `domain/value-objects/decay-factor.ts:1` | `memory/domain/value-objects/learning-severity.ts` |
| 9 | `domain/services/decay-calculator.ts:3` | `memory/domain/value-objects/learning-severity.ts` |
| 10 | `domain/services/consolidation-detector.ts:1` | `memory/domain/aggregates/learning.ts` |

- B.1 Los 10 imports apuntan exclusivamente a `memory/domain/...`. **OK.**
- B.2 Cero imports a `memory/application/` o `memory/infrastructure/`. **OK.**
- B.3 Mutación a través del repository abstraction:
  - `ConsolidateSimilarUseCase.processPair` (consolidate-similar.use-case.ts:206-210): invoca `loser.consolidateInto(...)` (método público del aggregate) y `await this.learnings.save(loser)`. Sin reach-into-private-state.
  - `ApplyDecay`/`markPruned` shortcut por SQL via `MemoryEntryWriter` (curator-owned port). Justificado en JSDoc del writer ("the adapter does NOT cross-import `memory/domain`. Every column it touches is named through SQL strings") y por presupuesto de 30s/50K entries documentado en `docs/05-memoria-decay.md` §6. Sólo toca `confidence`, `tags_json`, append a `pruned` y delete por id — no rompe invariantes del aggregate.
- B.4 Salida del validador: `[OK] curator (authorised cross-imports: memory×10)`. Coincide. **OK.**

### C. Composition root
`/code/src/composition/` no existe. **OK** (Fase 4).

### D. Convención `.port.ts`
Los 11 ports siguen el sufijo: `apply-decay.port.ts`, `consolidate-similar.port.ts`, `filesystem-checker.port.ts`, `memory-entry-reader.port.ts`, `memory-entry-writer.port.ts`, `prune-low-confidence.port.ts`, `rollup-session.port.ts`, `run-curator.port.ts`, `self-heal.port.ts`, `session-rollup-reader.port.ts`, `similarity-finder.port.ts`. **OK.**

### E. Use cases sin instanciar adapters
`grep -E "new (Sqlite|Vec0|Node|Interval)" application/` → 0 hits. **OK.**

### F. Migración SQL `003__pruned-and-curator-runs.sql`
- F.1 Idempotente: todos los `CREATE TABLE`/`CREATE INDEX` con `IF NOT EXISTS`.
- F.2 Filename matchea `/^(\d+)__([\w-]+)\.sql$/` de `migrations-runner.ts:94`.
- F.3 Sin secrets: solo DDL puro.
- F.4 No duplica tablas — 002 crea `embedding_queue`+`embedding_metadata`; 003 crea `pruned`+`curator_runs`. Sin solape.
- F.5 Schema concuerda con `PrunedEntry` (PK `(workspace_id, kind, original_id)`, CHECKs sobre `kind` y `reason`) y `CuratorRun`+`CuratorRunStats` (incluye `paths_corrected`, `embeddings_requeued`, `open_questions_aged`, `duration_ms`). Índices cubren `curator-log` y audit-trail.

### G. Reuse domain/services
`NodeFilesystemChecker` implementa `FilesystemChecker` (application port) Y `PathChecker` (domain port). La redundancia está documentada en ambos archivos: el dominio define el contrato (`PathChecker`); el `.port.ts` en application existe por convención §3.1. Una sola instancia se bindea a ambos nombres. Dirección Clean respetada.

### H. Adapters con ports
- `Vec0SimilarityFinder` implements `SimilarityFinder` ✓
- `SqliteCuratorRunRepository` implements `CuratorRunRepository` ✓
- `SqliteMemoryEntryReader` implements `MemoryEntryReader` ✓
- `NodeFilesystemChecker` implements `FilesystemChecker, PathChecker` ✓
- `SqliteSessionRollupReader` implements `SessionRollupReader` ✓
- `SqliteMemoryEntryWriter` implements `MemoryEntryWriter` ✓
- `SqlitePrunedEntryRepository` implements `PrunedEntryRepository` ✓
- `IntervalCuratorScheduler`: clase pública diseñada per §6 — composition-root la instancia con `RunCurator` inyectado.

## 5. ADR-001 — Ratificación final

| Triada | Cross-imports a `memory/domain/` | Validador |
|--------|----------------------------------|-----------|
| `retrieval` (Tarea 3.3) | 46 | `[OK] retrieval (authorised cross-imports: memory×46)` |
| `curator` (Tarea 3.4) | 10 | `[OK] curator (authorised cross-imports: memory×10)` |

`ADR_001_AUTHORISED_EXCEPTIONS` en `validate-modules.ts:84-87` contiene exactamente las dos entradas. Las 56 cross-imports caen todas dentro del alcance autorizado. Cero imports a `memory/application/`, `memory/infrastructure/`, ni a otros módulos hermanos. Las mutaciones pasan por repository abstraction o por shortcuts SQL justificados.

**B-005 → CERRADO.** Las dos excepciones a §1.5 están completamente cubiertas e impuestas por `npm run validate:modules`.

## 6. Veredicto

**APPROVED.** Tarea 3.4 cumple §1.5, §1.5.1 (ADR-001) y §3.1. Junto con Tarea 3.3, **B-005 CERRADO**.

---

_Persistido por el orquestador a partir del output del subagente
`clean-architecture-validator` (sandbox bloqueó la escritura directa).
Contenido fiel al reporte original._
