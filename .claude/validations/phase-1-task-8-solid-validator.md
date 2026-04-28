# SOLID + Type-Safety Validation — Phase 1, Task 8: retrieval/domain
**Validator:** solid-validator
**Date:** 2026-04-27
**Verdict:** APROBADO (sin advertencias bloqueantes; 3 sugerencias menores)

---

## Resultado de tsc estricto

**PASS — exit code 0, cero errores, cero warnings.**

Comando ejecutado (TypeScript 5.6.3, scratch project en
`/tmp/solidcheck-retrieval`):

```
npx -y -p typescript@5.6.3 tsc --noEmit -p tsconfig.json
```

`tsconfig.json` con TODOS los flags estrictos exigidos por §1.6:
`strict`, `noImplicitAny`, `strictNullChecks`, `strictFunctionTypes`,
`strictBindCallApply`, `strictPropertyInitialization`, `noImplicitThis`,
`alwaysStrict`, `noUnusedLocals`, `noUnusedParameters`,
`exactOptionalPropertyTypes`, `noImplicitReturns`,
`noFallthroughCasesInSwitch`, `noUncheckedIndexedAccess`,
`noImplicitOverride`, `noPropertyAccessFromIndexSignature`. Más 4
adicionales (`isolatedModules`, `forceConsistentCasingInFileNames`,
`skipLibCheck`, `allowImportingTsExtensions`).

**Scope incluido:** `code/src/shared/domain/**/*.ts` (14 archivos) +
`code/src/modules/memory/domain/**/*.ts` (76 archivos) +
`code/src/modules/retrieval/domain/**/*.ts` (42 archivos) =
**132 archivos del scope** + libs internas → **139 archivos totales**.

Resultado: **`exit=0`**. Los 42 archivos del scope retrieval compilan
limpio contra los 76 de `memory/domain` (Tarea 3) y los 14 de
`shared/domain` (Tarea 1) bajo el régimen estricto completo.

---

### Auditoría grep complementaria

| Patrón | Matches en `retrieval/domain/` |
|---|---|
| `: any` (anotación de tipo) | **0** |
| `as any` | **0** |
| `<any>` (type argument any) | **0** |
| `Promise<any>` | **0** |
| `Array<any>` | **0** |
| `Record<*, any>` | **1 — en JSDoc, NO en código** (`ranked-entry.ts:21` cita el shape de `MemoryEntry` del protocolo MCP §4.3) |
| `// @ts-ignore` | **0** |
| `// @ts-nocheck` | **0** |
| `// @ts-expect-error` | **0** |
| `eslint-disable` | **0** |
| `Date.now` / `new Date()` (en código) | **0** |
| `Math.random` / `crypto.*` | **0** |
| `process.*` / `console.*` (en código) | **0** |
| `throw new` | 33 — todos sobre errores tipados (`InvalidInputError`, `InvalidQueryError`, `InvalidRecallFiltersError`, `EmbeddingDimensionMismatchError`, `LayerAlreadyPresentError`, `TokenBudgetExceededError`); cero excepciones genéricas |

**Verificación del `Record<string, any>`** en `ranked-entry.ts:21`:
está dentro de un bloque ` ``` ` JSDoc que cita literalmente el tipo
`MemoryEntry` del protocolo MCP (`docs/02-protocolo-mcp.md` §4.3). NO es
código TypeScript ejecutable; es documentación. **APROBADO** — el
dominio no usa `any` en ninguna posición de tipo real.

### Casts (`as ...`) en posición de tipo

Se encontraron **5 ocurrencias reales** y todas son canónicas:

1. **`CONTEXT_LAYER_KINDS = [...] as const`** en `context-layer-kind.ts:49`
   — patrón A3 (validado en Tarea 1, Tarea 2, Tarea 7). SSOT runtime
   + tipo `ContextLayerKindValue = (typeof CONTEXT_LAYER_KINDS)[number]`.
   **APROBADO**.
2. **`QUERY_KINDS = [...] as const`** en `query-kind.ts:24` — mismo
   patrón. Deriva `QueryKindValue` desde el array. **APROBADO**.
3. **`WORKSPACE_MODE_LABELS = [...] as const`** en
   `workspace-anchor-payload.ts:25` — proyección de los 3 modos en el
   bounded context retrieval (NO importa el VO `WorkspaceMode` del
   módulo workspace, evitando coupling cross-module — la duplicación
   es decisión documentada en líneas 13-23 alineada con §1.5 Regla 2).
   **APROBADO**.
4. **`RECALL_FALLBACK_REASONS = [...] as const`** en
   `aggregates/recall-result.ts:20` — SSOT para los 2 fallback reasons
   del protocolo `mem.recall`. **APROBADO**.
5. **`normalised as IdValue<BundleIdBrand>`** en `bundle-id.ts:31` —
   replica EXACTAMENTE el patrón de `Id.create<TBrand>()` en
   `shared/domain/value-objects/id.ts:48`. El método compartido
   `Id.normalize()` retorna `string` (validación común), y la
   sub-clase debe re-aplicar el brand al ser un branded type
   nominal. Idéntico al cast usado por `Id.create()` mismo. Cero
   alternativa type-safe sin duplicar la regex de UUID v7.
   **APROBADO**.

**Cero `as any`, cero `as unknown`, cero `as Type` arbitrario.**

### `unknown` justificado

Se encontraron **6 ocurrencias** de `unknown` en código (no
comentarios) y todas caen dentro de la categoría permitida `cause?:
unknown` (patrón canónico ES2022 `Error.cause`):

| Archivo | Línea | Uso |
|---|---|---|
| `errors/retrieval-domain-error.ts` | 35 | `options?: { cause?: unknown }` |
| `errors/embedding-dimension-mismatch-error.ts` | 34 | `options?: { cause?: unknown }` |
| `errors/invalid-query-error.ts` | 27 | `options?: { field?: string; cause?: unknown }` |
| `errors/invalid-recall-filters-error.ts` | 25 | `options?: { field?: string; cause?: unknown }` |
| `errors/layer-already-present-error.ts` | 25 | `options?: { cause?: unknown }` |
| `errors/token-budget-exceeded-error.ts` | 39 | `options?: { cause?: unknown }` |

Patrón heredado uniforme (Tareas 1, 2, 3, 4, 6, 7). **Cero `unknown`
derivado en otras posiciones.** El payload del callback
`EmbeddingVector.withVector<T>(callback)` usa `Float32Array` concreto,
no `unknown`. Los `*Ref` payloads usan typed VOs (`DecisionId`,
`TaskId`, `TurnId`, `EntityId`, `SessionId`, `OpenQuestion`,
`WorkspaceAnchorPayload`) — cero `unknown` en payloads.

---

## Modularidad estricta (§1.5)

`grep -rEn "from \"" code/src/modules/retrieval/domain/` produce **108
imports**, todos clasificables en exactamente tres categorías:

1. **Imports a `../../../../shared/domain/...`** (~50 imports) —
   `domain-error.ts`, `domain-event.ts`, `id.ts`, `timestamp.ts`,
   `tokens.ts`, `tags.ts`, `workspace-id.ts`, `confidence.ts`,
   `non-empty-string.ts`, `invalid-input-error.ts`. Todos
   **PERMITIDOS** por §1.5 Regla 1 (`shared/` es transversal).
2. **Imports a `../../../memory/domain/...`** (~17 imports) —
   `decision-id`, `decision-title`, `scope`, `entity-id`,
   `entity-name`, `entity-kind`, `entity-description`, `task-id`,
   `task-title`, `task-status`, `task-priority`, `turn-id`,
   `turn-summary`, `session-id`, `session-intent`, `open-question`,
   `last-used`, `use-count`, `embedding-status`. **PERMITIDOS** por
   el spec explícito de Tarea 8 ("imports SOLO de `shared/domain/` y
   `memory/domain/`"). Las refs proyectivas (`DecisionRef`,
   `TaskRef`, etc.) referencian el id + título tipados del módulo
   memory por contrato del bundle (cada layer renderiza un proyección
   estable del aggregate persistente).
3. **Imports intra-módulo** (~41 imports) — todos relativos
   (`./...`, `../value-objects/...`, `../errors/...`,
   `../events/...`, `../aggregates/...`). **PERMITIDOS**.

```bash
$ grep -rEn "from \"" code/src/modules/retrieval/domain/ \
    | grep -E "modules/(workspace|curator|encryption|secrets|mcp-server|cli)|infrastructure|application"
# (vacío)
```

**Cero imports** desde `modules/workspace/`, `modules/curator/`,
`modules/encryption/`, `modules/secrets/`, `modules/mcp-server/`,
`modules/cli/`, ni desde capa `application/` o `infrastructure/`. La
regla de modularidad estricta se cumple sin excepciones.

### Re-export de `EmbeddingStatus` (§1.5 Regla 3)

`value-objects/embedding-status.ts` re-exporta `EmbeddingStatus` y
`EmbeddingStatusKind` del módulo memory (líneas 30-33). Trade-off
documentado exhaustivamente en líneas 1-29:
- la canonicidad se mantiene en `memory/` (es un piece of state del
  entry, no del retrieval);
- el re-export evita la traducción runtime entre dos representaciones
  indistinguibles;
- la alternativa "subir a `shared/`" está mencionada como opción
  futura si más módulos lo necesitan.

LSP-wise: hay UNA SOLA clase `EmbeddingStatus` en el codebase. La
sustituibilidad es perfecta por identidad — no hay subclase, no hay
proxy, no hay wrapper. **APROBADO**.

### Estructura interna correcta

`value-objects/aggregates/events/services/errors/repositories`. La
carpeta `repositories/` contiene **un solo archivo doc**
(`.no-repositories.md`) explicando por qué está vacía: `ContextBundle`
y `RecallResult` son outputs efímeros, no se persisten. La persistencia
vive en `memory/`. Decisión correcta y documentada (§1.3 — repositorios
solo para aggregates persistidos). **APROBADO**.

---

## Hallazgos

### CRÍTICOS (bloquean aprobación)

**Ninguno.** El código cumple §1.4 (SOLID), §1.5 (modularidad estricta)
y §1.6 (type-safety total) **sin violaciones bloqueantes**.

### ADVERTENCIAS (no bloqueantes — preventivas)

#### A1. OCP latente — `ContextLayer.payloadEquals` no tiene check exhaustivo `never`

- **Archivo:** `code/src/modules/retrieval/domain/value-objects/context-layer.ts:207-246`
- **Detalle:** El método privado `payloadEquals` hace narrowing
  `if (a.kind === "workspace_anchor" && b.kind === "workspace_anchor")`
  por cada uno de los 7 layer kinds, y termina con `return false` sin
  un check exhaustivo `default: const _exhaustive: never = a; throw`.
  Si un futuro contributor agrega un 8º layer kind a
  `ContextLayerKindValue` (y a la `ContextLayerValue` DU),
  TypeScript NO romperá compile aquí; el método silenciosamente
  retornará `false` para layers iguales del nuevo kind. Esto es un
  **OCP latente** — la regla "agregar un kind = una sola línea en
  el SSOT" se cumple solo si TODOS los consumers son exhaustivos.
- **Impacto actual:** **CERO** — los 7 kinds de hoy están todos
  cubiertos. La desviación solo se manifestaría al agregar el 8º.
- **Por qué no es crítico:** El SSOT (`CONTEXT_LAYER_KINDS`) está
  derivado de `as const`, así que TypeScript SÍ romperá el resto de
  los consumers que sí son exhaustivos (factories en `ContextLayer`,
  branches del DU en `ContextLayerValue`). El `payloadEquals` solo
  silencia el caso muy específico "equal de dos layers del nuevo
  kind"; en el peor caso un test de equality fallaría con un mensaje
  cristalino.
- **Fix sugerido (preventivo):** después de los 7 `if` reemplazar
  `return false` por:
  ```typescript
  // Exhaustive guard: una nueva kind en ContextLayerValue rompe esto.
  const _exhaustive: never = a;
  return _exhaustive;
  ```
  Costo cero, beneficio: el compilador rompe en compile-time si se
  agrega un layer kind sin actualizar `payloadEquals`.

#### A2. SRP / SoC — `ContextLayer.kindVO()` instancia `ContextLayerKind` en cada llamada

- **Archivo:** `code/src/modules/retrieval/domain/value-objects/context-layer.ts:172-174`
- **Detalle:** El accessor `kindVO()` ejecuta
  `ContextLayerKind.create(this.value.kind)` en cada llamada. La
  validación es O(7) pero la asignación de un objeto nuevo por cada
  acceso ocurre en hot paths como `ContextBundle.truncate()`
  (línea 226: `this.layers.map((layer, ...) => ({ ..., priority:
  layer.kindVO().priority() }))`).
- **Type-safety:** **CERO leaks**. El comportamiento es funcionalmente
  correcto. Es decisión de cohesión vs performance.
- **Impacto actual:** Insignificante. `truncate()` se ejecuta cuando
  la budget se aprieta a posteriori, no en cada `mem.context`.
  `addLayer` lo llama una sola vez por layer (≤7).
- **Fix sugerido (futuro, micro-opt):** cachear el VO al construir el
  `ContextLayer` o, alternativamente, pasar el kindVO al constructor
  como parámetro precomputado. Ambas opciones tienen costo nulo. Para
  el MVP no aporta valor.

#### A3. ISP — `Embedder.embed()` y `embedBatch()` ¿podrían segregarse?

- **Archivo:** `code/src/modules/retrieval/domain/services/embedder.ts:34-47`
- **Detalle:** La interface `Embedder` tiene 2 métodos
  (`embed`, `embedBatch`). Algunos adapters podrían beneficiarse de
  implementar SOLO uno (e.g. un embedder remoto sin batching nativo
  caería en `embedBatch` como `Promise.all(texts.map(embed))`).
- **Conclusión:** La interface tiene 2 métodos; está MUY POR DEBAJO
  del umbral de "muchos métodos". `embedBatch` es genuinamente útil
  para el curator (re-embedding masivo cuando cambia el modelo) y
  el adapter local con `fastembed-js` lo soporta nativamente con
  mejor latencia que `Promise.all(map(embed))`. **Mantener como
  está.** Si en el futuro un adapter remoto sin batching aparece,
  puede implementar `embedBatch` con el `Promise.all` trivial sin
  violar el contrato.

### POSITIVOS

#### SOLID (§1.4)

- **SRP** — Cada uno de los 42 archivos tiene UNA razón de cambio:
  - **23 VOs** (1 razón por VO):
    - `EmbeddingVector` (proyección de un vector flotante con cosine
      built-in) — la `Float32Array` defensive copy + `withVector`
      callback es su responsabilidad EXCLUSIVA;
    - `BM25Score` / `CosineScore` / `RecencyScore` / `UsageScore` /
      `RelevanceScore` (5 score VOs, cada uno un único shape numérico
      con sus invariantes propios — `[0,1]` para los componentes,
      `≥0` no acotado para el final);
    - `RelevanceWeights` (4 pesos), `PriorityBoost` (multiplicador
      `≥1` y `≤10`), `TokenBudget` (par max+used con `consume`
      inmutable);
    - `ContextLayerKind` (catálogo de 7 + priority lookup),
      `QueryKind` (catálogo de 5);
    - `ContextLayer` (composite class wrapper sobre la DU
      `ContextLayerValue` — ver nota dedicada más abajo);
    - `Query` (input compuesto: text+kinds+tags+filters+
      includeSuperseded), `QueryText` (string con cap), `RecallFilters`
      (input compuesto: kinds+tags+confidence+time-range+limit);
    - `WorkspaceAnchorPayload` (payload de la Capa 1 con
      workspace+session+metadata);
    - 6 `*Ref` (`DecisionRef`, `TaskRef`, `TurnRef`, `EntityRef`,
      `OpenQuestionRef`, `MemoryRef`) — proyecciones por kind para
      las layers tipadas + el `MemoryRef` heterogéneo para la layer
      `relevant_memory`;
  - **3 aggregates/proyecciones**:
    - `ContextBundle` (root con id+layers+budget+events: enforcer
      del invariante de budget y ordering canónico);
    - `BundleId` (UUID v7 branded para el bundle);
    - `RankedEntry` + `RecallResult` (proyecciones del recall pipeline
      — VOs sin identidad bajo `aggregates/` por composición);
  - **5 services (4 ports + 1 domain service puro)**:
    - `Embedder`, `LexicalSearch`, `VectorSearch`, `TokenCounter` —
      4 driven ports (interfaces) que el dominio define para que la
      infrastructure implemente;
    - `HybridScorer` — domain service estático puro: la fórmula de
      fusión es regla de negocio, NO se inyecta;
  - **6 errors** (`RetrievalDomainError` abstract + 5 concretos);
  - **4 events** (`ContextBundleAssembled`, `ContextLayerAdded`,
    `ContextBundleTruncated`, `RecallExecuted`);
  - **1 doc** (`repositories/.no-repositories.md` — justificación
    arquitectónica de por qué no hay repositorios).

  **Conteo bruto del aggregate principal (ContextBundle):** 355
  líneas, 15 métodos públicos. De los 15: 2 factories
  (`assemble`, `rehydrate`), 2 mutaciones (`addLayer`, `truncate`),
  9 getters/queries (`getId`, `getWorkspaceId`, `getSessionId`,
  `getQuery`, `getTokenBudget`, `getAssembledAt`, `getLayers`,
  `hasLayerOfKind`, `findLayer`, `layersCount`), 1 drain
  (`pullEvents`). Los 9 getters son contractuales del bundle como
  proyección — la layer de application lee TODOS al serializar para
  JSON-RPC. El conteo está **dentro del rango aceptable** para un
  aggregate raíz que custodia el composite de 7 capas + budget.

  **`ContextLayer` con 13 métodos públicos**: 7 factories per kind
  (`workspaceAnchor`, `activeDecisions`, `openTasks`, `recentTurns`,
  `relevantMemory`, `entitiesInFocus`, `openQuestions`) + 6
  accessors (`toValue`, `kindVO`, `kind`, `tokens`, `entriesCount`,
  `equals`). Las 7 factories SON el closure point de OCP — agregar
  un nuevo layer kind requiere agregar UN factory + UN branch en la
  DU `ContextLayerValue` + UNA entrada en `CONTEXT_LAYER_KINDS`.
  Patrón equivalente al `Id<TBrand>` de Tarea 1: el wrapper sobre la
  DU es la decisión correcta porque el bundle necesita tratar layers
  uniformemente preservando el tipo del payload.

  **`RelevanceScore` con 13 públicos**: 2 factories (`zero`, `of`) +
  `assemble` (factory composite) + 6 component getters
  (`getBM25`, `getCosine`, `getRecency`, `getUsage`,
  `getPriorityBoost`, `getWeights`) + `toNumber` + `isHigherThan` +
  `equals`. Los 6 component getters cumplen la responsabilidad
  declarada en el JSDoc líneas 24-27 ("para que el recall pipeline
  pueda introspectar y explicar el score (útil para el audit log)").

  Ningún archivo del scope supera los 355 líneas; ningún VO supera
  los 220 líneas (`recall-filters.ts` a 220 con su factory + 4
  asserts privados + equals exhaustivo).

- **OCP** — Cero `if (kind === "X") { ... } else if (kind === "Y") { ... }`
  en posición de dispatch. Los 7 valores de `CONTEXT_LAYER_KINDS` y
  los 5 de `QUERY_KINDS` viven en el SSOT `as const`, y los consumers
  los manejan vía:
  - **Polimorfismo de factory** — `ContextLayer.workspaceAnchor`,
    `.activeDecisions`, `.openTasks`, ... (1 factory por kind, ningún
    `if` interno);
  - **Lookup por map** — `ContextLayerKind.priority()` lee del
    `Object.freeze(LAYER_ORDER)` con index dinámico (lookup O(1));
  - **Loop sobre el SSOT** — `isValue` (type guard) itera la lista
    defensivamente; agregar un kind no requiere editar el guard.
  - **Iteración por priority** — `ContextBundle.truncate()` ordena
    por `priority()` DESC y dropea los más bajos primero, sin
    conocer los kinds individuales;
  - **Flat-list dispatch en errors** — `LayerAlreadyPresentError`
    almacena el `ContextLayerKindValue` literal del kind ofensor
    (sin switch).

  El `ContextLayer.payloadEquals` (líneas 207-246) es el ÚNICO
  lugar con un patrón de `if` per kind (8 branches). Es el caso límite
  donde la DU exige narrowing per branch (TypeScript necesita los
  guards para refinar `a.payload` y `b.payload` al tipo correcto).
  Falta el `never` exhaustivo al final — ver A1 en advertencias.

  **Cero switches gigantes con dispatch dinámico.** Las 4 ocurrencias
  de `switch` en el scope son **cero**: el código usa loops `for` con
  `noUncheckedIndexedAccess` honrado, y narrowings por `if` cuando
  TypeScript lo exige.

- **LSP** — Las 5 subclases concretas de error
  (`EmbeddingDimensionMismatchError`, `InvalidQueryError`,
  `InvalidRecallFiltersError`, `LayerAlreadyPresentError`,
  `TokenBudgetExceededError`) heredan de `RetrievalDomainError` que
  hereda de `DomainError`. Cada una **estrecha** el contrato del
  padre con campos `readonly` adicionales (`expectedDim`,
  `actualDim`, `field`, `layerKind`, `requestedTokens`,
  `availableTokens`, `maxTokens`) sin debilitar pre/postcondiciones.
  El `jsonRpcCode: number | null = null` en cada subclase es una
  refinación válida del `jsonRpcCode: number | null` abstracto del
  padre. Los 5 mantienen un `code` estable kebab-case
  (`retrieval.embedding-dimension-mismatch`,
  `retrieval.invalid-query`, `retrieval.invalid-recall-filters`,
  `retrieval.layer-already-present`, `retrieval.token-budget-exceeded`).

  `BundleId extends Id<BundleIdBrand>` (con `BundleIdBrand = "bundle"`)
  — sustituible por `Id<TBrand>` en cualquier signature genérica;
  `equals(other: Id<BundleIdBrand>): boolean` heredado y nunca
  override.

  El `EmbeddingStatus` re-exportado del módulo memory tiene UNA
  sola clase concreta — sustituibilidad perfecta por identidad.

- **ISP** — Las 4 driven ports son específicas y MÍNIMAS:
  - `Embedder`: 2 métodos cohesivos (`embed`, `embedBatch`). La
    distinción justifica su existencia (recall vs curator bulk).
  - `LexicalSearch`: 1 método (`search`). Una sola responsabilidad
    (FTS5 BM25 sobre el workspace). Imposible más estrecha.
  - `VectorSearch`: 1 método (`search`). Simétrico al anterior
    (sqlite-vec cosine). Imposible más estrecha.
  - `TokenCounter`: 2 métodos (`count` síncrono, `countBatch`
    async). La sincronía de `count` es contractual (hot path
    durante `mem.context`); el `countBatch` async cubre adapters
    remotos como Voyage.

  Ninguna implementación se vería forzada a `throw new Error("not
  supported")`. La separación de ports en archivos distintos
  (`embedder.ts`, `lexical-search.ts`, `vector-search.ts`,
  `token-counter.ts`) permite que un adapter implemente solo los
  ports que necesita — un test mock puede implementar
  `LexicalSearch` sin tocar `VectorSearch`.

- **DIP** — `ContextBundle` aggregate y `HybridScorer` service
  cumplen DIP estrictamente:
  - `ContextBundle` recibe TODO por parámetro (`workspaceId`,
    `sessionId`, `query`, `tokenBudget`, `assembledAt`, ...) en
    `assemble(input)` y `rehydrate(input)`. Cero `new` de adapters
    o ports. Los `new` que SÍ ejecuta son a clases del mismo bounded
    context (`ContextBundle`, `ContextBundleAssembled`,
    `ContextBundleTruncated`, `ContextLayerAdded`) o a errores de
    `shared/domain` (`LayerAlreadyPresentError` propio del módulo,
    `TokenBudgetExceededError` propio del módulo) — todos legítimos
    por §1.4.
  - `HybridScorer` es **static class con `private constructor()`
    explícito** (línea 56-58: "// never instantiated"). Cero
    instancias, cero estado, cero adapters. La función `score(input)`
    delega a `RelevanceScore.assemble(input)`. Es un namespace
    funcional sin dependencias inyectadas.
  - El dominio **nunca lee el reloj**: `Timestamp` siempre llega como
    parámetro inyectado (`occurredAt`, `assembledAt`, `executedAt`,
    `recordedAt`, `lastUsedAt`) por la composition root vía el puerto
    `Clock`. **Cero `Date.now()`, cero `new Date()`, cero
    `Math.random`, cero `crypto.*`, cero `process.*`, cero
    `console.*`** en el scope.
  - Las 4 driven ports (`Embedder`, `LexicalSearch`, `VectorSearch`,
    `TokenCounter`) son `interface` puros, no `abstract class`;
    declaran contrato sin implementación. Las implementaciones vivirán
    en `infrastructure/embedder/`, `infrastructure/persistence/`,
    `infrastructure/tokenization/` y serán inyectadas por composition
    root al use case.

#### Modularidad estricta (§1.5)

- **Cero imports cross-módulo prohibidos.** Los ~108 imports listados
  van exclusivamente a:
  - `shared/domain/...` (~50);
  - `memory/domain/...` (~17, autorizados por spec de Tarea 8);
  - intra-módulo (~41).
  Cero referencias a `workspace/`, `curator/`, `encryption/`,
  `secrets/`, `mcp-server/`, `cli/`, ni a capas `application/` o
  `infrastructure/`.
- **Estructura interna correcta**:
  `value-objects/aggregates/events/services/errors/repositories`.
  El último contiene un solo archivo `.no-repositories.md` con la
  justificación arquitectónica (apropiado dado que el módulo no
  persiste sus aggregates).
- **Aplicación canónica de `import type`**: ~50 de los ~108 imports
  usan `import type` cuando solo se requiere el tipo en signatures
  (`Tags`, `Confidence`, `Tokens`, `Timestamp`, `WorkspaceId`,
  `BundleId`, `SessionId`, `Query`, `RecallFilters`,
  `EmbeddingVector`, `RelevanceScore`, `BM25Score`, `CosineScore`,
  `RecencyScore`, `UsageScore`, `RelevanceWeights`, `PriorityBoost`,
  `QueryText`, `QueryKindValue`, `ContextLayerKindValue`,
  `RecallFallbackReasonValue`, `LastUsed`, `DomainEvent`). Esto
  ayuda al tree-shaker, al build paralelo y refuerza el aislamiento
  entre VOs.

#### Type-safety total (§1.6)

- **Cero `any`** en posición de tipo (verificado por grep + por
  `tsc --strict --noImplicitAny` pasa limpio). La única ocurrencia
  textual de `any` está en JSDoc citando el shape del protocolo MCP.
- **Casts (`as`) solo canónicos**: 5 ocurrencias, 4 son `as const`
  para SSOT (`CONTEXT_LAYER_KINDS`, `QUERY_KINDS`,
  `WORKSPACE_MODE_LABELS`, `RECALL_FALLBACK_REASONS`) y 1 es el cast
  obligado de re-brand `IdValue<BundleIdBrand>` que replica el
  patrón canónico de `Id.create<TBrand>()` en shared. **Cero `as
  any`, cero `as unknown`, cero `as Type` arbitrario.**
- **Cero `// @ts-ignore` / `// @ts-nocheck` /
  `// @ts-expect-error`**.
- **Cero `eslint-disable` o equivalente.**
- **`unknown` justificado y minimizado**: 6 ocurrencias TODAS en
  `cause?: unknown` (patrón canónico ES2022 `Error.cause`). **Cero
  `unknown` en payloads de `*Ref`, en discriminated unions, ni en
  callbacks.** El callback `EmbeddingVector.withVector<T>(callback)`
  tipa el buffer como `Float32Array` concreto.
- **Tipos de retorno explícitos** en TODAS las funciones/métodos de
  la superficie pública: factories
  (`EmbeddingVector.create(components): EmbeddingVector`,
  `EmbeddingVector.cosineDistance(other): number`,
  `EmbeddingVector.cosineSimilarityTo(other): CosineScore`,
  `EmbeddingVector.toFloat32Array(): Float32Array`,
  `TokenBudget.withMax(max): TokenBudget`,
  `TokenBudget.of(input): TokenBudget`,
  `TokenBudget.remaining(): Tokens`, `TokenBudget.canFit(t): boolean`,
  `TokenBudget.consume(t): TokenBudget`,
  `TokenBudget.isExhausted(): boolean`,
  `Query.create(input): Query`, `Query.getKinds(): readonly QueryKind[]`,
  `Query.getKindValues(): readonly QueryKindValue[]`,
  `Query.hasNoKindFilter(): boolean`, `Query.matchesKind(k): boolean`,
  `RecallFilters.create(input): RecallFilters`,
  `RecallFilters.getKinds(): readonly QueryKind[]`,
  `ContextBundle.assemble(input): ContextBundle`,
  `ContextBundle.rehydrate(input): ContextBundle`,
  `ContextBundle.addLayer(input): void`,
  `ContextBundle.truncate(input): void`,
  `ContextBundle.getLayers(): readonly ContextLayer[]`,
  `ContextBundle.findLayer(kind): ContextLayer | null`,
  `ContextBundle.pullEvents(): readonly DomainEvent[]`,
  `HybridScorer.score(input): RelevanceScore`,
  `Embedder.embed(text): Promise<EmbeddingVector>`,
  `Embedder.embedBatch(texts): Promise<readonly EmbeddingVector[]>`,
  `LexicalSearch.search(...): Promise<readonly LexicalSearchHit[]>`,
  `VectorSearch.search(...): Promise<readonly VectorSearchHit[]>`,
  `TokenCounter.count(text): Tokens`,
  `TokenCounter.countBatch(texts): Promise<readonly Tokens[]>`,
  ...). **Cero inferencia implícita en superficie pública.**
- **`exactOptionalPropertyTypes` honrado** — los 6 errores usan el
  patrón `options !== undefined ? { cause: options.cause } :
  undefined` (verificado en `retrieval-domain-error.ts:38`,
  `embedding-dimension-mismatch-error.ts:40`,
  `invalid-query-error.ts:31`, `invalid-recall-filters-error.ts:29`,
  `layer-already-present-error.ts:28`,
  `token-budget-exceeded-error.ts:45`). Los tipos union usan
  `BM25Score | null`, `CosineScore | null`, `Timestamp | null`,
  `Confidence | null`, `SessionId | null`, `Query | null`,
  `SessionIntent | null`, `RecallFallbackReasonValue | null` (no
  `?:` opcional) — el null es **dato explícito** en el contrato del
  retrieval pipeline (un entry "no scored on lexical" = `bm25Score:
  null`, no `bm25Score: undefined`).
- **`noUncheckedIndexedAccess` honrado** — verificado en TODOS los
  loops:
  - `embedding-vector.ts:120-121`: `const a = this.buffer[i] ?? 0;
    const b = other.buffer[i] ?? 0;`
  - `embedding-vector.ts:174-176`: `if (this.buffer[i] !==
    other.buffer[i]) return false;` (TS infiere ambos como `number |
    undefined` y la comparación con `!==` es válida cuando ambos
    son del mismo tipo);
  - `context-layer-kind.ts:146-148`: `const known =
    CONTEXT_LAYER_KINDS[i]; if (known !== undefined && known ===
    candidate) return true;`
  - `query-kind.ts:97-99`: idéntico patrón sobre `QUERY_KINDS`;
  - `recall-result.ts:147-149`: idéntico patrón sobre
    `RECALL_FALLBACK_REASONS`;
  - `workspace-anchor-payload.ts:124-126`: idéntico patrón sobre
    `WORKSPACE_MODE_LABELS`;
  - `context-bundle.ts:235-242`: `const cursor =
    indicesByPriorityDesc[i]; if (cursor === undefined) continue;
    const droppedLayer = this.layers[cursor.index]; if
    (droppedLayer === undefined) continue;`
  - `context-bundle.ts:246-249`: `if (survivors[i] === true) {
    const survivor = this.layers[i]; if (survivor === undefined)
    continue; survivingLayers.push(survivor); }`
  - `context-bundle.ts:255-257`: `const survivor =
    survivingLayers[i]; if (survivor === undefined) continue;`
  - `context-bundle.ts:316-320`: `const layer = this.layers[i]; if
    (layer === undefined) continue;` (en `hasLayerOfKind`,
    `findLayer`).
  - `context-layer.ts:255-258`: `const x = a[i]; const y = b[i]; if
    (x === undefined || y === undefined) return false;` (en
    `refArrayEquals`).
  - `query.ts:91-95`, `query.ts:112-117`, `query.ts:128-133`,
    `recall-filters.ts:105-110`, `recall-filters.ts:120-126`,
    `recall-filters.ts:210-217`, `recall-result.ts:177-182`: todos
    con guard `if (k === undefined) continue;` o `if (a === undefined
    || b === undefined) return false;`
  - `workspace-anchor-payload.ts:170-180`: `const key = keys[i]; if
    (key === undefined) continue; const value = raw[key]; if
    (typeof value !== "string") throw ...; out[key] = value;`
- **`noPropertyAccessFromIndexSignature` honrado** — el lookup
  `LAYER_ORDER[this.value]` (`context-layer-kind.ts:165`) usa bracket
  notation porque `this.value: ContextLayerKindValue` es la unión
  cerrada keyof, no un index signature; tsc lo permite. La
  metadata bag `Readonly<Record<string, string>>` en
  `WorkspaceAnchorPayload` accede con `a[key]`/`b[key]` (líneas
  173, 195), bracket notation correcta.
- **`noImplicitOverride` honrado** — los 5 errores concretos no
  usan `override` keyword porque NO overridean métodos del padre,
  solo agregan campos `readonly` propios + el `code`/`jsonRpcCode`
  abstractos del padre (que TypeScript no clasifica como override
  por ser abstracts). `BundleId.from` es `static`, no override.
- **`noImplicitReturns` honrado** — todas las funciones con tipo de
  retorno no-`void` retornan en TODOS los caminos.
- **`noFallthroughCasesInSwitch` honrado** — **cero switch
  statements** en el scope, lo que elimina la categoría completa de
  fall-through bugs.
- **Discriminated unions correctos:**
  - `ContextLayerKindValue` — unión de 7 string literals derivada de
    `(typeof CONTEXT_LAYER_KINDS)[number]`. Type guard `isValue`
    exhaustivo.
  - `QueryKindValue` — unión de 5 string literals derivada de
    `(typeof QUERY_KINDS)[number]`.
  - `WorkspaceModeLabel` — unión de 3 derivada de
    `(typeof WORKSPACE_MODE_LABELS)[number]`.
  - `RecallFallbackReasonValue` — unión de 2 derivada de
    `(typeof RECALL_FALLBACK_REASONS)[number]`.
  - `ContextLayerValue` — DU manual de 7 branches con `kind` como
    discriminator. La DU está alineada 1:1 con `CONTEXT_LAYER_KINDS`
    (verificado por inspección — cada literal del array tiene un
    branch en la DU).
  - `EmbeddingStatusKind` — re-export del módulo memory (3 valores).
- **Inmutabilidad disciplinada**:
  - `private constructor` en TODOS los VOs concretos (23/23) y en
    el aggregate `ContextBundle`.
  - `readonly` en TODOS los campos públicos: `score`, `value`,
    `kind`, `id`, `title`, `preview`, `tags`, `relevanceScore`,
    `confidence`, `lastUsedAt`, `createdAt`, `recordedAt`, `summary`,
    `description`, `location`, `entityKind`, `name`, `priority`,
    `status`, `bundleId`, `workspaceId`, `sessionId`, `layerKind`,
    `tokensConsumed`, `entriesCount`, `tokensReclaimed`,
    `tokensBefore`, `tokensAfter`, `droppedLayers`, `eventName`,
    `occurredAt`, `expectedDim`, `actualDim`, `requestedTokens`,
    `availableTokens`, `maxTokens`, `field`, `code`, `jsonRpcCode`.
  - `Object.freeze` en arrays retornados por `getLayers`
    (`context-bundle.ts:311`), `pullEvents`
    (`context-bundle.ts:343, 346`), `getKindValues`
    (`query.ts:96`, `recall-filters.ts:110`), `dedupeKinds`
    (`query.ts:152`, `recall-filters.ts:218`), factories de layers
    (`context-layer.ts:103`, `113`, `123`, `133`, `143`, `153`),
    `RecallResult.of` (`recall-result.ts:135`), `droppedLayers` en
    `ContextBundleTruncated` (`context-bundle-truncated.ts:54`),
    `metadata` en `WorkspaceAnchorPayload` (`workspace-anchor-
    payload.ts:182`).
  - **`EmbeddingVector` defensive copy** verificada en `create`
    (líneas 76-87): construye un `Float32Array(length)` fresh y lo
    llena en un loop; el caller no puede mutar el buffer interno.
    El método `withVector<T>(callback)` documenta socialmente el
    contrato read-only (líneas 142-153). El método
    `toFloat32Array()` retorna copia defensiva via `copy.set(buffer)`
    (líneas 165-169). **Type-safety completo: el buffer interno
    nunca leak por reference fuera del callback documentado.**
  - `consume(tokens)` en `TokenBudget` retorna NUEVA instancia
    (línea 118: `return new TokenBudget(this.maxTokens,
    this.usedTokens + requested);`); `this` nunca muta.
- **`pullEvents` devuelve `readonly DomainEvent[]`** en
  `ContextBundle` (`context-bundle.ts:342-347`) y drena el buffer
  (`this.events.length = 0`); segunda llamada devuelve
  `Object.freeze([])`. Mismo contrato que en aggregates de
  `workspace/`, `memory/`, `cli/`.
- **JSDoc de invariantes** en TODOS los archivos — cada VO declara
  invariantes y semántica de equality. El aggregate
  `ContextBundle` documenta pre/postcondiciones de cada mutación, la
  racionalidad de su existencia (líneas 19-62), por qué es aggregate
  y no VO, por qué no se persiste, y cómo el truncate ordena por
  priority. Cada error documenta su `code`, su `jsonRpcCode`
  (justificando el `null`), e invariantes propios.
- **Trazabilidad a docs**: cada archivo cita la sección relevante de
  `docs/01-arquitectura.md` §2.6 / §2.7 (scoring + fallback),
  `docs/02-protocolo-mcp.md` §1 / §4.2 / §4.3 (caps, mem.context,
  mem.recall), `docs/03-modelo-datos.md` §2 / §4 / §5 / §6 (config,
  FTS5, vec, embedding metadata), `docs/04-capas-contexto.md` §2
  (las 7 capas), §3.x (capas individuales), §7 (adaptaciones por
  tamaño), §10 (token counter), `docs/06-stack-tecnico.md` §6 / §7 /
  §10 (fastembed, sqlite-vec, tiktoken),
  `docs/12-lineamientos-arquitectura.md` §1.3 / §1.4 / §1.5 / §1.6.
- **Errores wrappean `cause` con `Object.defineProperty`** vía la
  base `DomainError` (heredado de Tarea 1) — sin polyfill,
  `enumerable: false` para no contaminar logs.
- **`code` como `readonly`** en todos los errores con identificadores
  estables kebab-case (`retrieval.invalid-query`,
  `retrieval.invalid-recall-filters`,
  `retrieval.embedding-dimension-mismatch`,
  `retrieval.layer-already-present`,
  `retrieval.token-budget-exceeded`).
- **`jsonRpcCode` explícito y documentado**: `null` en TODOS los
  errores retrieval (justificación contractual en cada archivo:
  el catalog de §6 del protocolo MCP no asigna wire-codes para estos
  fallos; el adapter mapea típicamente a `INVALID_PARAMS`).

#### Aspectos específicos del scope (Tarea 8)

- **`EmbeddingVector` con `Float32Array` defensive copy**: type-safe
  total. `create(components)` valida `instanceof Float32Array ||
  Array.isArray(components)`, length > 0, every component finite, y
  copia componente por componente al buffer interno. El `withVector`
  callback es la ÚNICA puerta a la referencia raw del buffer y su
  contrato read-only está documentado en JSDoc líneas 142-153
  ("the callback contract MUST treat the buffer as read-only — the
  docstring spells that out and there is no enforcement"). El
  `toFloat32Array()` retorna copia defensiva. **Cero leaks de tipos:
  el buffer nunca aparece como `unknown` ni como `any`.**

- **`TokenBudget` invariante `usedTokens ≤ maxTokens` bien
  custodiado**:
  - `withMax(max)` valida `Number.isFinite + isInteger + max > 0`,
    inicializa `usedTokens = 0`.
  - `of({maxTokens, usedTokens})` valida ambos integers, ambos
    rangos (`max > 0`, `used >= 0`), y rechaza `used > max`.
  - `consume(tokens)` calcula `requested = tokens.toNumber()`,
    `available = max - used`, y lanza
    `TokenBudgetExceededError` si `requested > available`. Si pasa,
    retorna `new TokenBudget(max, used + requested)` — invariante
    preservada por el rechazo previo.
  - `canFit(tokens)` es predicate non-throwing.
  - `isExhausted()` lee `usedTokens >= maxTokens`.
  - **Cero camino donde `usedTokens > maxTokens` quede en el VO**
    — todas las factories validan el invariante, y `consume`
    refuerza con check pre-construcción.

- **`*Ref` types con narrowing correcto, cero any en payloads**:
  - `DecisionRef`: id (`DecisionId`), title (`DecisionTitle`), tags
    (`Tags`), scope (`Scope`), confidence (`Confidence`),
    relevanceScore (`RelevanceScore`). Todos VOs tipados.
  - `EntityRef`: id (`EntityId`), name (`EntityName`), entityKind
    (`EntityKind`), description (`EntityDescription`), location
    (`string | null`), confidence (`Confidence`), relevanceScore.
    El `location: string | null` está justificado en JSDoc líneas
    27-30 (la columna subyacente es nullable; envolverlo en un
    path/locator VO está fuera de scope del bounded context
    retrieval). **APROBADO** — `null` explícito, no `unknown`.
  - `MemoryRef`: kind (`QueryKind` discriminator), id (`string`),
    title/preview (`NonEmptyString`), tags, confidence, lastUsedAt
    (`Timestamp | null`), relevanceScore. El `id: string` está
    justificado en JSDoc líneas 30-32 (carrier heterogéneo para
    todos los kinds; el discriminator `kind: QueryKind` permite el
    narrowing en consumers). **APROBADO**.
  - `OpenQuestionRef`: sessionId (`SessionId`), question
    (`OpenQuestion`), recordedAt (`Timestamp`). Identidad por par
    (session, question) — natural cuando no hay synthetic id en
    `sessions.metadata_json`.
  - `TaskRef`: id (`TaskId`), title (`TaskTitle`), status
    (`TaskStatus`), priority (`TaskPriority`), tags, relevanceScore.
  - `TurnRef`: id (`TurnId`), summary (`TurnSummary`), recordedAt,
    confidence, tags, relevanceScore.

  **Cero `any` en payloads de los 6 `*Ref`. Cero `unknown`. Cero
  campos sin tipar. Narrowing correcto via `equals` (id-based para
  los typed, kind+id para `MemoryRef`, session+question para
  `OpenQuestionRef`).**

- **`HybridScorer` como static class pura (no instancia adapters)**:
  verificado en líneas 56-58: `private constructor() { // never
  instantiated }`. `score(input)` recibe los 5 componentes
  (BM25Score, CosineScore, RecencyScore, UsageScore, PriorityBoost)
  + `RelevanceWeights` y delega a `RelevanceScore.assemble(input)`
  que ejecuta la fórmula
  `additive = bm25*w + cosine*w + recency*w + usage*w; final =
  additive * priorityBoost`. **Cero side effects, cero adapters,
  cero inyección, cero estado mutable.** Es service de dominio puro
  (no port). La justificación arquitectónica está en JSDoc líneas
  9-54 (la fórmula es regla de negocio, no tecnología abstraíble).

- **Switches exhaustivos con `default: never`**: el scope NO
  contiene `switch` statements actualmente. Cuando los consumers
  futuros (use cases, terminal adapter) escriban
  `switch (layer.kind()) { ... default: const _exhaustive: never =
  layer.kind(); throw ... }`, el SSOT `as const` garantiza que
  agregar un kind SIEMPRE rompe el switch del consumer en
  compile-time. **El dominio cumple su parte.** La única función
  con multi-branch estructural es `ContextLayer.payloadEquals`
  (ver A1 — el único hueco preventivo).

- **`ContextLayer` class wrapper sobre DU**: NO mezcla
  responsabilidades. La DU `ContextLayerValue` está exportada como
  type alias separado (líneas 24-43) — adapters que prefieren
  pattern-matching pueden usarla sin tocar la clase. La clase
  agrega 4 responsabilidades cohesivas y documentadas en JSDoc
  líneas 47-79:
  1. accessor `kindVO()` para usar `priority()` sin recreación;
  2. `tokens()` accessor para que el budget arithmetic viva en un
     solo lugar;
  3. `equals(other)` estructural recursivo;
  4. factories per kind (closure point de OCP).
  La decisión está justificada arquitectónicamente: el bundle
  necesita tratar layers uniformemente preservando el tipo de cada
  payload — la combinación class + DU es el patrón TypeScript
  canónico para eso. **APROBADO — single responsibility:
  "ser el composite VO que combina kind + payload + tokens en un
  contenedor uniforme tratable por el aggregate".**

---

## Veredicto justificado

**APROBADO.**

Los **42 archivos** del scope retrieval/domain cumplen los
lineamientos §1.4 (SOLID), §1.5 (modularidad estricta) y §1.6
(type-safety total) **sin excepciones bloqueantes**. La compilación
con `tsc --strict` y los 17 flags exigidos pasa con cero errores y
cero warnings sobre el corpus completo (132 archivos del scope:
shared/ + memory/ + retrieval/, 139 totales con libs internas).

**Cumplimiento type-safety total (§1.6):**
- Cero `any`, cero `as any`, cero `// @ts-ignore`,
  cero `// @ts-nocheck`, cero `// @ts-expect-error`,
  cero `eslint-disable`.
- Cero lectura de wall-clock (`Date.now`, `new Date()`),
  cero RNG (`Math.random`, `crypto.*`), cero side effects
  (`console.*`, `process.*`).
- `unknown` minimizado a la categoría permitida `cause?: unknown` (6
  ocurrencias, todas en errores). Cero `unknown` en payloads de
  `*Ref`, en discriminated unions, ni en callbacks.
- Discriminated unions exhaustivas derivadas de SSOT `as const`
  (`CONTEXT_LAYER_KINDS`, `QUERY_KINDS`, `WORKSPACE_MODE_LABELS`,
  `RECALL_FALLBACK_REASONS`).
- Tipos de retorno explícitos en toda función/método.
- `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`,
  `noPropertyAccessFromIndexSignature`, `noImplicitOverride`,
  `noFallthroughCasesInSwitch` honrados.

**Cumplimiento SOLID (§1.4):**
- **SRP**: cada uno de los 42 archivos tiene UNA razón de cambio.
  El aggregate `ContextBundle` con 15 métodos (2 factories + 2
  mutaciones + 9 getters/queries + pullEvents + 1 boilerplate) está
  dentro de rango aceptable para un aggregate raíz custodio del
  composite de 7 layers + budget. `ContextLayer` con 13 métodos
  (7 factories per kind + 6 accessors) es inevitable: las 7
  factories SON el closure point OCP. `RelevanceScore` con 13
  métodos (3 factories + 6 component getters + 4 accessors) cumple
  la responsabilidad declarada de "explicabilidad del score para el
  audit log".
- **OCP**: agregar un nuevo layer kind, query kind, workspace mode
  label o fallback reason es **una línea** en el SSOT — cero código
  existente se modifica salvo (1) agregar branch en la DU
  `ContextLayerValue`, (2) agregar factory en `ContextLayer`, (3)
  agregar entrada en `LAYER_ORDER`. Los tipos derivados se actualizan
  en cascada por TypeScript. `payloadEquals` tiene un OCP latente
  preventivo (A1, no bloqueante).
- **LSP**: los 5 errores concretos heredan de
  `RetrievalDomainError → DomainError` estrechando con campos
  `readonly` propios y refinando `jsonRpcCode` a `null`, sin
  debilitar pre/postcondiciones. `BundleId extends Id<BundleIdBrand>`
  sustituible. `EmbeddingStatus` re-exportado tiene UNA sola clase
  concreta — sustituibilidad perfecta.
- **ISP**: las 4 driven ports (`Embedder` 2 métodos, `LexicalSearch`
  1, `VectorSearch` 1, `TokenCounter` 2) son específicas y mínimas.
  Cada port en archivo separado permite mocks parciales sin forzar
  `throw new Error("not supported")`.
- **DIP**: `ContextBundle` aggregate recibe TODO por parámetro;
  cero `new` de adapters. `HybridScorer` es static class con
  `private constructor()` documentado como "never instantiated";
  cero estado, cero adapters, cero inyección. El dominio nunca lee
  el reloj. Los 4 ports son `interface` puros.

**Cumplimiento modularidad estricta (§1.5):**
- Cero imports cross-módulo prohibidos (verificado por grep). Los
  ~108 imports van exclusivamente a `shared/domain/...` (~50,
  permitidos), `memory/domain/...` (~17, autorizados por spec de
  Tarea 8) e intra-módulo (~41).
- Estructura interna correcta:
  `value-objects/aggregates/events/services/errors/repositories`.
  El último contiene un solo archivo `.no-repositories.md` con
  justificación arquitectónica.
- Re-export de `EmbeddingStatus` desde `memory/` documentado y
  alineado con §1.5 Regla 3 (la canonicidad permanece en `memory/`,
  el re-export evita traducción runtime).

**Las 3 advertencias listadas son sugerencias preventivas:**

- **A1** (OCP latente): `ContextLayer.payloadEquals` no tiene
  exhaustive check con `never` — agregar el `const _exhaustive:
  never = a; return _exhaustive;` después de los 7 `if`. Costo
  cero, beneficio: compile-time guard al agregar layer kinds.
- **A2** (perf micro): `ContextLayer.kindVO()` instancia un
  `ContextLayerKind` en cada llamada. Cachear en el constructor
  ahorraría allocs en `truncate()` (path frío). No bloquea.
- **A3** (ISP descartado): `Embedder` con 2 métodos (`embed` +
  `embedBatch`) está MUY POR DEBAJO del umbral; los 2 métodos son
  cohesivos y útiles. Mantener como está.

Ninguna advertencia afecta corrección actual ni viola ningún
lineamiento.

El módulo `retrieval/domain` está listo para que la Fase 2 monte la
infraestructura compartida (`code/package.json`, `code/tsconfig.json`,
`code/eslint.config.js` — bloqueador documentado en
`memory-domain.advertencias_pendientes_para_cierre_fase.O2`) y para
que la Fase 3 implemente:
- la capa application: use cases `BuildContextBundleUseCase`,
  `RecallUseCase`, `EmbedTextUseCase`, con composición pura de
  `ContextBundle.assemble()` + `Embedder.embed()` +
  `LexicalSearch.search()` + `VectorSearch.search()` +
  `HybridScorer.score()` + `TokenCounter.count()`;
- la capa infrastructure: adapters
  `FastEmbedJsEmbedder implements Embedder`,
  `SqliteFts5LexicalSearch implements LexicalSearch`,
  `SqliteVecVectorSearch implements VectorSearch`,
  `TiktokenTokenCounter implements TokenCounter` (con fallback
  `chars/4` heuristic).

---

## Próximo paso recomendado

1. **Liberar el siguiente validador del workflow** (ddd-validator
   sobre Tarea 8).
2. **Materializar `code/package.json`, `code/tsconfig.json`,
   `code/eslint.config.js`** antes de iniciar Fase 2 (bloqueador
   O2 documentado en Tarea 3). El `tsconfig.json` final debe
   contener TODOS los 17 flags estrictos validados aquí.
3. **(Cuando se aborde Fase 5 / QA)** Tests unitarios sobre
   invariantes específicas:
   - **`EmbeddingVector`**:
     - rechaza `Float32Array(0)`, array vacío, `[NaN]`, `[Infinity]`,
       `[null]`, `[undefined]`;
     - acepta `Float32Array.from([0.1, 0.2, 0.3])` y `[0.1, 0.2,
       0.3]`;
     - `cosineDistance(self) === 0`;
     - `cosineDistance` con dim mismatch lanza
       `EmbeddingDimensionMismatchError` con `expectedDim` y
       `actualDim` correctos;
     - `cosineDistance` para dos vectores zero retorna 0
       (special-case para fallback);
     - `withVector(callback)` devuelve `T` y NO copia;
     - `toFloat32Array()` retorna copia (verificar con `===` que es
       distinto del buffer interno);
     - `equals` componente-wise.
   - **`TokenBudget`**:
     - `withMax(0)`, `withMax(-1)`, `withMax(1.5)`, `withMax(NaN)`,
       `withMax(Infinity)` lanzan;
     - `of({max: 100, used: 101})` lanza;
     - `consume(tokens > available)` lanza con
       `requestedTokens`/`availableTokens`/`maxTokens` correctos;
     - `consume` retorna nueva instancia (verificar referencia
       distinta);
     - `canFit` es non-throwing.
   - **`ContextBundle`**:
     - `addLayer` rechaza segundo layer del mismo kind con
       `LayerAlreadyPresentError`;
     - `addLayer` rechaza layer con tokens > available con
       `TokenBudgetExceededError`;
     - `addLayer` emite `ContextLayerAdded`;
     - `truncate(newMax >= used)` no emite event;
     - `truncate(newMax < used)` dropea por priority DESC, emite
       `ContextBundleTruncated` con `tokensReclaimed === before -
       after`;
     - `getLayers` retorna ordenado por priority ASC;
     - `pullEvents` idempotente: segunda llamada `[]` frozen.
   - **`ContextLayer.payloadEquals`** (cuando se aplique fix A1):
     - exhaustive check sobre los 7 kinds;
     - simétrico (`equals(a, b) === equals(b, a)`).
   - **`HybridScorer.score`**:
     - sum aritmético correcto con todos los componentes presentes;
     - bm25=null contribuye 0 al additive (penaliza el lonely
       cosine-only);
     - cosine=null contribuye 0 al additive;
     - priorityBoost=PriorityBoost.none() = identidad multiplicativa;
     - resultado = max(0, additive * boost) — non-negative.
   - **`RecallFilters.create`**:
     - rechaza `mustHave ∩ mustNot ≠ ∅`;
     - rechaza `since > until`;
     - rechaza `limit > 100`, `limit <= 0`, `limit no entero`.
