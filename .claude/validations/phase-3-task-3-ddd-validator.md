# Phase 3 Task 3 — ddd-validator

**Cycle:** 0
**Verdict:** APPROVED
**Date:** 2026-04-27

## Scope

`code/src/modules/retrieval/application/` and `code/src/modules/retrieval/infrastructure/`. Domain validated in Phase 1, only checked here for non-violation by app/infra.

## Verdict: APPROVED

Zero critical violations against `docs/12 §1.2`, ADR-001 (`§1.5.1`), `docs/01 §2.6`/`§2.7`, and the seven-layer model of `docs/04`.

## A. Lenguaje del dominio — PASS
- Use cases: `RecallMemoryUseCase`, `GetContextBundleUseCase`, `CountTokensUseCase`, `EmbedAndPersistUseCase` — verbs of the business.
- Adapters: `SqliteFts5LexicalSearch`, `SqliteVecVectorSearch`, `SqliteMemoryProjectionRepository`, `SqliteEmbeddingQueueRepository`, `RawEmbedderAdapter`, `TiktokenTokenCounter`, `AsyncEmbeddingWorker` — port + tech.
- No `Manager`/`Helper`/`Util`. The single `Item` token is `EmbeddingQueueItem`, justified as queue-row terminology in the port doc.

## B. VOs / aggregates en use cases — PASS
- Inputs/outputs: `Query`, `RecallFilters`, `TokenBudget`, `RelevanceWeights`, `WorkspaceId`, `EmbeddingVector`, `Tokens`, `Timestamp`, `BM25Score`, `CosineScore`, `RecencyScore`, `UsageScore`, `PriorityBoost`, `RelevanceScore`, `BundleId`, `ContextLayer`, `MemoryRef`, `*Ref`.
- D-023: `RawEmbedderAdapter` wraps the shared `Float32Array`-typed port into the retrieval-owned `EmbeddingVector` VO.
- `RecallResult` and `ContextBundle` aggregates returned in full.
- `MemoryProjection` (port DTO) carries VOs (`Tags`, `Confidence`, `UseCount`, `LastUsed`, `LearningSeverity`, `Timestamp`); only `kind/id/title/preview` are primitives, justified as a rescore *input*.

## C. Repos retornan projections completas — PASS
`SqliteMemoryProjectionRepository` reconstructs every `*Ref`/`WorkspaceAnchorPayload` via `*.of(...)`/`*.from(...)` factories from typed VOs.

## D. ADR-001 — PASS
- Cross-imports to `memory/domain` are read-only VOs/branded ids; no `Decision`/`Learning`/`Entity`/`Task`/`Turn` aggregate is instantiated in retrieval.
- Writes confined to retrieval-owned tables (`embedding_queue`, `embeddings`, `embedding_metadata`) plus the documented recall side-effect `bumpUsage` (SQL UPDATE on `use_count`/`last_used_ms`, not aggregate mutation in-process — matches `docs/01 §2.6`).

## E. Eventos — observación (no crítica)
`RecallExecuted`, `ContextBundleAssembled`, `ContextBundleTruncated`, `ContextLayerAdded` exist; `ContextBundle.pullEvents()` exposed. No use case publishes events because no project-wide `EventBus`/`EventPublisher` port exists yet (same gap as memory module). Project-wide integration gap, not a retrieval DDD violation.

## F. D-101 / D-102 — PASS
- D-101: `PriorityBoost.of(3)` (critical) and `PriorityBoost.of(1.5)` (warning) — both within domain bounds [1, 10], multiplicative semantics preserved.
- D-102: Use cases use snake_case domain literals (`workspace_anchor`, `active_decisions`, ...) directly; no wire mapping in retrieval.

## G. Errores tipados — PASS
- `RetrievalInfrastructureError` base + `TiktokenLoadFailedError`, `PermanentEmbeddingFailureError` (kebab-case codes).
- The two `throw new Error(...)` in use cases (recall-memory.use-case.ts:432, get-context-bundle.use-case.ts:715) are unreachable exhaustive-switch type guards, not domain errors. Acceptable.
- No use case invents domain errors.

## Soft notes (non-blocking)
1. `SqliteMemoryProjectionRepository` line 771 defines a private `WorkspaceDisplayName extends NonEmptyString` placeholder, self-documented as collapsing into Tarea 3.5's canonical class.
2. `RecallExecuted` / `ContextBundleAssembled` events not yet published — wire when the project gains an event-bus port.

## Veredicto final y razón

**APPROVED.** El módulo `retrieval` (application + infrastructure) cumple §1.2 sin violaciones críticas. Use cases con verbos de negocio, manejan aggregates `RecallResult` y `ContextBundle` solo via factories y métodos públicos. Cross-imports respetan ADR-001 (solo a `memory/domain/`, read-only). PriorityBoost multiplicativo conformado al domain (D-101 pendiente Fase 5). ContextLayerKind names domain-flavoured sin mapping wire (D-102 pendiente Fase 5). Errores tipados separan domain vs infrastructure correctamente.

---

_Persistido por el orquestador a partir del output del subagente
`ddd-validator` (sandbox bloqueó la escritura directa). Contenido fiel
al reporte original._
