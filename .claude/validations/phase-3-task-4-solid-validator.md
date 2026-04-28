# Phase 3 Task 4 — solid-validator

**Cycle:** 0
**Verdict:** APPROVED
**Date:** 2026-04-27

**Scope**: `code/src/modules/curator/application/` y `code/src/modules/curator/infrastructure/`.

## A. SOLID

- **SRP**: each use case has ONE responsibility; all files under ~235 lines. `RunCuratorUseCase` orchestrates only; `ApplyDecay/Consolidate/Prune/Rollup/SelfHeal` each own one pass.
- **OCP**: no `if (kind === "X") { ... }` polymorphism. The `kind.isLearning()/isTurn()/...` chains in `SqliteMemoryEntryReader` / `SqliteMemoryEntryWriter` route to per-table SQL strings (closed-enum dispatch over `MemoryEntryKind`) and explicitly raise `unsupportedKind` for an unknown kind. No polymorphic logic encoded in conditionals.
- **LSP**: `NodeFilesystemChecker implements FilesystemChecker, PathChecker` — both interfaces have identical signatures and contracts (order-preserving, no per-path throw, may throw on scan-level error). LSP holds for both. All SQLite repositories return `null`/empty arrays per port contracts.
- **ISP**: ports stay narrow. `MemoryEntryReader` (3 methods) and `MemoryEntryWriter` (3 methods) split read vs write per spec. `FilesystemChecker`, `SimilarityFinder`, `SessionRollupReader` and every driving port expose 1 method.
- **DIP**: every use case receives ports via constructor; no `new SqliteXxx(...)` inside any application file. `IntervalCuratorScheduler` accepts `RunCurator` (the in-port).

## B. Type-safety

1. `grep ": any|as any|<any>"` in `src/modules/curator` → only false positive in JSDoc prose at `curator-run.ts:257`. Zero type-level `any`.
2. `grep "ts-ignore|ts-nocheck|ts-expect-error"` → **zero matches**.
3. `npx tsc --noEmit` → exit 0, no output.
4. `npm run lint` (`eslint src --max-warnings 0`) → exit 0, zero warnings.
5. Explicit return types on every public method.
6. JSON-from-DB boundaries validated with Zod everywhere: `CuratorRunRowSchema`, `PrunedRowSchema`, `Decision/Learning/Entity/Task/TurnRowSchema`, `TagsArraySchema`, `EmbeddingRowSchema`, `KnnRowSchema`, `EntityLocationRowSchema`. The single structural narrowing `(cause as { code?: unknown }).code` in `NodeFilesystemChecker` is gated by a `typeof === "object"` guard and lands on `unknown` — safe, not `any`.

## C. `.port.ts` convention

All 11 application ports under `application/ports/in/` (6) and `application/ports/out/` (5) carry the `.port.ts` suffix. Domain `PathChecker` correctly lives in `domain/services/` per existing convention (domain-internal port).

## D. Idempotency & stale-run recovery

`RunCuratorUseCase.guardInFlightRun(...)` raises typed `CuratorApplicationError.runAlreadyInflight(...)` (`curator.run-already-inflight`) for fresh in-flight runs and `CuratorApplicationError.staleRunRecovered(...)` (`curator.stale-run-recovered`) after recovering rows older than `STALE_RUN_THRESHOLD_MS = 5min`. All `catch` clauses use `cause: unknown`. Idempotency: writer methods return `boolean` for no-op detection; repository `save(...)` are upsert-by-PK; `ConsolidateSimilar` skips folded ids via a `Set<string>`; `IntervalCuratorScheduler` guards re-entry with an `inflight` flag plus a 5-minute cooldown.

## Hallazgos críticos

Ninguno.

## Hallazgos no críticos

Ninguno mayor. La narrowing estructural de `(cause as { code?: unknown })` está bien acotada.

## Verdict

**APPROVED** — zero critical violations. tsc clean, ESLint clean, zero `any`, zero `ts-ignore`, SOLID respected, `.port.ts` convention complete, idempotency and stale-run recovery use typed errors and `unknown`-safe catches.

---

_Persistido por el orquestador a partir del output del subagente
`solid-validator` (sandbox bloqueó la escritura directa). Contenido fiel
al reporte original._
