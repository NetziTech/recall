# Phase 3 Task 4 — ddd-validator

**Cycle:** 0
**Verdict:** APPROVED
**Date:** 2026-04-27

**Scope audited:**
- `code/src/modules/curator/application/`
- `code/src/modules/curator/infrastructure/`

## A. Lenguaje del dominio — PASS
Use cases con verbos de negocio: `RunCuratorUseCase`, `ApplyDecayUseCase`, `ConsolidateSimilarUseCase`, `PruneLowConfidenceUseCase`, `RollupSessionUseCase`, `SelfHealUseCase`. Adapters reflejan puerto+tecnología: `SqliteCuratorRunRepository`, `SqlitePrunedEntryRepository`, `SqliteMemoryEntryReader`, `SqliteMemoryEntryWriter`, `SqliteSessionRollupReader`, `Vec0SimilarityFinder`, `NodeFilesystemChecker`, `IntervalCuratorScheduler`. Cero genéricos.

## B. Use cases con aggregates/VOs del domain — PASS
- `RunCurator` mueve el aggregate `CuratorRun` solo vía `start()` / `complete()` / `recordFinding` / `recordConsolidation` / `recordPrune`. Sin setters libres.
- `DecayCalculator` (puro, static-only) consume `DecayFactor.forKind(...)` recalibrado per-day (HANDOFF B-002) — los literales solo viven en `decay-factor.ts`.
- Inputs/outputs usan VOs: `Confidence`, `WorkspaceId`, `Timestamp`, `MemoryEntryKind`, `LearningSeverity`, `ConsolidationThreshold`, `PruneThreshold`, `CuratorRunId`, `CuratorRunTrigger`, `CuratorRunStats`.

## C. Repositorios con aggregates completos — PASS
- `SqliteCuratorRunRepository.parseRow(...)` reconstruye `CuratorRun` vía `CuratorRun.rehydrate(...)` con validación Zod.
- `SqlitePrunedEntryRepository.parseRow(...)` reconstruye `PrunedEntry` vía `PrunedEntry.create(...)`.
- `MemoryEntryReader` / `SessionRollupReader` son puertos de PROYECCIÓN read-only (documentado como "flat projection by design"); las mutaciones de aggregates de memory pasan por `LearningRepository.save(...)` / `SessionRepository.save(...)` (cross-imports ADR-001).
- **`parseTaskRow` con defaults (`confidence ?? 1`, `last_used_ms ?? created_at_ms`, `use_count ?? 0`)** — bounded y sin riesgo: alimenta solo la proyección plana del curator; combinado con `DecayFactor.forKind(task,null)===1.0`, el decay short-circuita en `factor.isUnity()` y `applyDecay(...)` nunca se llama para `task`. NO viola invariantes del aggregate `Task`.

## D. ADR-001 — PASS
Cross-imports verificados: solo `memory/domain/repositories/{learning,session}-repository.ts`, `memory/domain/aggregates/learning.ts` (type-only), `memory/domain/value-objects/{learning-id,learning-severity,session-summary}.ts`. Cero imports a `memory/application/` o `memory/infrastructure/`. Mutaciones cruzadas vía métodos del aggregate: `Learning.consolidateInto(...)`, `Session.setSummary(...)`, `Session.end(...)`.

## E. Consolidación semántica — PASS
- `ConsolidationThreshold.default() === 0.92` y `qualifies(score)` usa `>` estricto (matches docs/05 §3 "if (sim > THRESHOLD)").
- `Vec0SimilarityFinder` filtra vía `threshold.qualifies(...)`.
- Loser: `Learning.consolidateInto(target)` + `PrunedEntry` con razón `consolidated_into_other` (audit trail preservado).
- **Observación NO BLOQUEANTE:** la fusión winner-side (suma de use_count, merge de contenido, timestamp transfer) está deliberadamente fuera de scope MVP — el JSDoc lo declara explícitamente y el evento `LearningsConsolidated` lleva la `ConsolidationPair` para que un `LearningsAbsorbedUseCase` futuro la complete sin romper invariantes.

## F. Self-healing — honestidad de placeholders — PASS
`SelfHealUseCase` implementa Caso 1 (path-stale) end-to-end. Casos 2/3/5 retornan `0` literales con JSDoc explícito ("placeholders ... return zero counters"). `findingsRecorded` solo suma trabajo real ejecutado. NO miente al usuario; no reporta "fixed: 0" como si la lógica corrió.

## G. Eventos — PASS
Past tense + namespace `curator.*` kebab: `curator.run-started`, `curator.run-completed`, `curator.entry-pruned`, `curator.health-finding-detected`, `curator.learnings-consolidated`. Todos implementan `DomainEvent`, props `readonly`, llevan solo datos del hecho. Application/infrastructure NUNCA instancian eventos directamente — solo el aggregate `CuratorRun` los emite.

## H. Idempotencia (runId tracking) — PASS
`runId` fluye por cada sub-use-case (`ApplyDecay`, `ConsolidateSimilar`, `SelfHeal`, `PruneLowConfidence`). Cada uno carga el `CuratorRun` por id y registra mutaciones append-only; `CuratorRunAlreadyCompletedError` si se intenta mutar un run completado. `save(...)` upsert idempotente. Guard de in-flight con `STALE_RUN_THRESHOLD_MS=5min` + recovery vía force-complete con stats vacíos.

**Observación NO BLOQUEANTE:** `CuratorApplicationError.staleRunRecovered(...)` se construye pero su valor se descarta (solo logger.warn). Funcionalmente no-op; o eliminar la llamada o surface el valor.

## Observaciones no bloqueantes (backlog)
1. Wire `LearningsAbsorbedUseCase` futuro para absorción winner-side (docs/05 §3).
2. `staleRunRecovered` factory call es código muerto — limpiar.
3. Schema de `tasks` (columnas nullable) — reconciliar con spec en capa DB; fuera de scope de esta auditoría.
4. Casos 2/3/5 de Self-Heal: cuando aterricen, mantener patrón de honestidad (no convertir ceros en strings "skipped" mendaces).

## Veredicto

**APPROVED.** El módulo `curator` (application + infrastructure) cumple §1.2 sin violaciones críticas. Use cases con verbos de negocio, manejan el aggregate `CuratorRun` solo vía métodos (`start/complete/recordFinding/recordConsolidation/recordPrune`), nunca con setters. El `DecayCalculator` puro consume `DecayFactor` recalibrado per-day (B-002). Repositorios reconstruyen aggregates completos vía factories del domain con validación Zod; los puertos `MemoryEntryReader` / `SessionRollupReader` son proyecciones read-only deliberadas. `parseTaskRow` con defaults nullable es seguro: alimenta solo proyección plana, y el decay short-circuita en `factor.isUnity()`. Cross-imports respetan ADR-001 (solo a `memory/domain/`). Threshold de consolidación es `0.92` con `>` estricto; loser archived a `pruned`. Self-heal reporta honestamente (Casos 2/3/5 retornan `0` literales con JSDoc explícito). Eventos en past-tense kebab `curator.*` solo emitidos por el aggregate. `runId` fluye por todos los sub-use-cases garantizando idempotencia. Observaciones no bloqueantes: absorción winner-side de consolidación pendiente para iteración futura; `staleRunRecovered` factory call es código muerto.

---

_Persistido por el orquestador a partir del output del subagente
`ddd-validator` (sandbox bloqueó la escritura directa). Contenido fiel
al reporte original._
