# Phase 3 Task 3 — solid-validator

**Cycle:** 0
**Verdict:** APPROVED
**Date:** 2026-04-27

## Resumen ejecutivo

| Eje | Estado |
|-----|--------|
| `tsc --noEmit` | OK (exit 0) |
| `npm run lint` (`--max-warnings 0`) | OK (exit 0) |
| `: any` / `as any` / `<any>` en módulo retrieval | 0 ocurrencias |
| `ts-ignore` / `ts-nocheck` / `ts-expect-error` | 0 ocurrencias |
| Convención `.port.ts` (en `application/ports/`) | Cumplida (3 in / 2 out) |
| `Float32Array` en hot-path embedding | Correcto (VO `EmbeddingVector` + adapters) |
| Discriminated union exhaustiva (`fallback_reason`) | OK (`never` en switches; tipo literal en `RecallFallbackReasonValue`) |
| Prepared statements en SQL | OK en los 4 adapters |
| `new <Adapter>` en application | 0 (DI por constructor en los 4 use cases) |

## A. SOLID

### SRP
- `RecallMemoryUseCase` (456 LOC) y `GetContextBundleUseCase` (788 LOC) son largos pero su responsabilidad es coherente; los métodos privados están bien segregados (`hydrateCandidates`, `rankAndSlice`, `runEmbeddedSearch`, `classifyFallback`, builders por capa).
- `EmbedAndPersistUseCase` (238 LOC) y `CountTokensUseCase` (31 LOC) — limpios.
- Adapters infra cada uno con responsabilidad única (queue, vec0, FTS5, projection-read, embedder lift, token counter, worker scheduler).

### OCP
- No hay switch sobre `kind` con dispatch lógico oculto. Los dos `switch (kind)` (en `recall-memory.use-case.ts:419` y `get-context-bundle.use-case.ts:702`) son mappings 1:1 a factories de `QueryKind` con `const exhaustive: never = kind` — patrón aprobado.
- `KIND_TABLE` y `FTS_BINDINGS` son data-driven (Record/array readonly), no dispatch.

### LSP
- `RawEmbedderAdapter` envuelve el `Embedder` (shared) en `EmbeddingVector` y valida `vector.length === dimension` antes de construir el VO. No introduce excepciones nuevas no documentadas; propaga las del raw embedder, lo cual el contrato del puerto autoriza.
- `TiktokenTokenCounter.count()` lanza si `disposed === true`. Defensa interna del adapter, aceptable.

### ISP
- Puertos pequeños:
  - `RecallMemory`, `GetContextBundle`, `CountTokens`: 1 método cada uno.
  - `EmbeddingQueueRepository`: 6 métodos cohesivos en el ciclo del queue + persistencia del vector.
  - `MemoryProjectionRepository`: **8 métodos** (loadWorkspaceAnchor, listActiveDecisions, listOpenTasks, listRecentTurns, listOpenQuestions, loadProjectionsByHits, loadEntityRefsByIds, bumpUsage).
- **OBSERVATION (no crítico)**: `MemoryProjectionRepository` está sobre el umbral de 5. La docstring justifica cohesión ("read-surface + bump del recall side-effect"). El adapter SQLite implementa los 8 sin throws "not supported"; los use cases consumen subconjuntos distintos. Recomendación futura: segmentar en `MemoryStructuralReadRepository` + `MemoryHydrationRepository`. NO bloqueante.

### DIP
- Los 4 use cases reciben todos los puertos por constructor.
- Cero `new SqliteX` / `new RawEmbedderAdapter` / `new Tiktoken*` / `new AsyncEmbeddingWorker` en `application/`.
- `AsyncEmbeddingWorker` recibe `EmbedAndPersistUseCase` por constructor (no lo instancia).

## B. Type-safety

### tsconfig
Verificado en `code/tsconfig.json`: `strict: true` + los 17 flags requeridos por §1.6 + `useUnknownInCatchVariables`, `forceConsistentCasingInFileNames`. PASS.

### tsc / lint
- `npx tsc --noEmit` → exit 0.
- `npm run lint` (`--max-warnings 0`) → exit 0.

### `any` y suprimidores
- `: any` / `as any` / `<any>` en `code/src/modules/retrieval/` → **0 matches**.
- `ts-ignore` / `ts-nocheck` / `ts-expect-error` → **0 matches**.

### Tipos de retorno explícitos
Todos los métodos públicos y privados de use cases, adapters y worker declaran tipo de retorno. PASS.

### Float32Array
- VO `EmbeddingVector` envuelve un `Float32Array` privado, factory `create()` hace defensive copy, valida `Number.isFinite` por componente.
- `RawEmbedderAdapter` valida `raw.vector.length !== raw.dimension` antes de construir el VO.
- `SqliteVecVectorSearch` y `SqliteEmbeddingQueueRepository` usan `Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength)` correctamente sobre el buffer del VO.
- No hay `number[]` en el hot path.

### Discriminated unions exhaustivas
- `RecallFallbackReasonValue = "embedder_unavailable" | "no_embeddings_yet"` (tipo literal en `recall-result.ts`); `classifyFallback(...)` retorna `RecallFallbackReasonValue | null`.
- Switches sobre `QueryKindValue` con `const exhaustive: never = kind` en ambos use cases. PASS.

### Validación en boundaries
- `SqliteMemoryProjectionRepository`: 8 schemas Zod (Decision/Learning/Entity/Task/Turn rows, WorkspaceConfig, Session, OpenQuestionsJson, Tags). Todo `JSON.parse` pasa por `Schema.parse(...)` o `typeof === "string"` checks.
- `SqliteEmbeddingQueueRepository`: `QueueRowSchema`, `CountRowSchema`.
- `SqliteFts5LexicalSearch`: `HitRowSchema` por fila bm25.
- `SqliteVecVectorSearch`: `HitRowSchema` por fila K-NN.
- Cero `as Type` sobre output de `JSON.parse`. PASS.

## C. Convención `.port.ts`

Los 5 puertos en `application/ports/` cumplen sufijo `.port.ts`:
- `in/recall-memory.port.ts`, `in/get-context-bundle.port.ts`, `in/count-tokens.port.ts`
- `out/memory-projection-repository.port.ts`, `out/embedding-queue-repository.port.ts`

Los puertos en `domain/services/` (`embedder.ts`, `lexical-search.ts`, `vector-search.ts`, `token-counter.ts`) NO usan `.port.ts`, coherente con §3.1 que reserva el sufijo para `application/ports/`. La docstring de `application/ports/index.ts` lo justifica explícitamente. PASS.

## D. Performance hooks

- `RecallMemoryUseCase`: `Promise.all([lexicalPromise, embedderPromise])` paraleliza el split. `loadProjectionsByHits` un round-trip por batch. `bumpUsage` dentro de `db.transaction`.
- `GetContextBundleUseCase`: `Promise.all` 6-way para layers 1-4-7 + queryDriven. Solo una invocación de embedder y una de vector search compartidas entre layers 5/6.
- `EmbedAndPersistUseCase`: hidratación batched (`loadProjectionsByHits` para todo el batch, no per-row).
- Prepared statements: TODO acceso SQL pasa por `this.db.prepare(SQL_*)`. Las únicas interpolaciones de string en SQL (`buildSelect` en FTS5, `placeholders.map(()=>"?").join(", ")` en projection-repo) interpolan valores literales del enum o cantidad de placeholders, NO valores de usuario. PASS.

## Hallazgos críticos

Ninguno.

## Hallazgos no críticos / recomendaciones

1. **ISP — `MemoryProjectionRepository` 8 métodos**. Cohesivo y bien justificado hoy; segmentar en `MemoryStructuralReadRepository` + `MemoryHydrationRepository` si crece más.
2. **SRP — `GetContextBundleUseCase` 788 LOC**. Cohesión correcta; si se añade Capa 8+ extraer `LayerBuilders` a helpers separados.
3. **`AsyncEmbeddingWorker.scheduleNextDrain`** se auto-reagenda al final de `runDrain`; el contrato podría documentarse algo más explícitamente, pero no afecta corrección.

## Veredicto final y razón

**APPROVED**. Cero hallazgos críticos. SOLID respetado, type-safety estricta sin escapes (cero `any`, cero `ts-ignore`, `tsc` y `eslint` limpios), convención `.port.ts` cumplida en `application/ports/`, prepared statements en todo el SQL con validación Zod en los boundaries, `Float32Array` correctamente encapsulado en `EmbeddingVector`, discriminated unions exhaustivas (`QueryKindValue` con `never`, `RecallFallbackReasonValue` literal). Las recomendaciones son de evolución futura, no de violación actual.

---

_Persistido por el orquestador a partir del output del subagente
`solid-validator` (sandbox bloqueó la escritura directa). Contenido fiel
al reporte original._
