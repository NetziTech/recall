# SOLID + Type-Safety Validation — Phase 1, Task 3: memory/domain
**Validator:** solid-validator
**Date:** 2026-04-27
**Verdict:** APROBADO (con 4 advertencias menores no bloqueantes)

---

## Resultado de tsc estricto

**PASS — exit code 0, cero errores, cero warnings.**

Comando ejecutado (TypeScript 5.6.3, scratch project en
`/tmp/solidcheck-memory`):

```
tsc --noEmit \
  --strict \
  --noImplicitAny \
  --strictNullChecks \
  --strictFunctionTypes \
  --strictBindCallApply \
  --strictPropertyInitialization \
  --noImplicitThis \
  --alwaysStrict \
  --noUnusedLocals \
  --noUnusedParameters \
  --exactOptionalPropertyTypes \
  --noImplicitReturns \
  --noFallthroughCasesInSwitch \
  --noUncheckedIndexedAccess \
  --noImplicitOverride \
  --noPropertyAccessFromIndexSignature \
  --isolatedModules \
  --forceConsistentCasingInFileNames \
  --skipLibCheck \
  --target ES2022 \
  --module ESNext \
  --moduleResolution bundler \
  --allowImportingTsExtensions \
  $(find code/src/shared/domain code/src/modules/workspace/domain code/src/modules/memory/domain -type f -name '*.ts')
```

Resultado: **`Exit code: 0`**. Los **70 archivos** de `memory/domain`
(28 VOs + 7 aggregates + 18 events + 10 errors + 7 repositories) más
los 16 de `workspace/domain` y los 14 de `shared/domain` (100 archivos
TypeScript en total) compilan limpio bajo el régimen estricto completo
(los 17 flags exigidos por §1.6 + 3 adicionales: `isolatedModules`,
`forceConsistentCasingInFileNames`, `skipLibCheck`).

> Nota: el conteo real es 70 archivos (28+7+18+10+7), no 63 como dice
> el handoff. El handoff parece haber subestimado por unas pocas
> unidades, pero no afecta a la validación.

### Auditoría grep complementaria

| Patrón | Matches en `memory/domain/` |
|---|---|
| `: any` (espacio + identificador) | **0** |
| `as any` | **0** |
| `<any>` | **0** |
| `Promise<any>` | **0** |
| `Array<any>` | **0** |
| `// @ts-ignore` | **0** |
| `// @ts-nocheck` | **0** |
| `// @ts-expect-error` | **0** |
| `eslint-disable` / `tslint:disable` | **0** |
| `Date.now` / `new Date()` / `process.` / `console.` | **0** |
| `Math.random` / `crypto.` | **0** |
| `throw new` (in domain) | 61 — todos sobre `InvalidInputError` o errores `MemoryDomainError` (cero excepciones genéricas) |

### Casts (` as `) en posición de tipo

Se encontraron en `memory/domain/`:

1. **`as const`** sobre arrays de literales (10 ocurrencias —
   `SCOPE_KINDS`, `ACTOR_KINDS`, `EMBEDDING_STATUS_KINDS`,
   `TASK_PRIORITY_KINDS`, `LEARNING_SEVERITY_KINDS`,
   `TASK_STATUS_KINDS`, `ENTITY_KINDS`, `RELATION_ENDPOINT_KINDS`,
   `RELATION_KINDS`, `DECISION_STATUS_KINDS`). Patrón canónico para
   derivar `(typeof X)[number]` y aplica el A3 que recomendó el
   validator de Tarea 2 — **APROBADO**.

2. **Brand attribution** en los 7 IDs hijos de `Id<TBrand>`
   (`decision-id.ts:23`, `entity-id.ts:19`, `learning-id.ts:18`,
   `relation-id.ts:19`, `session-id.ts:18`, `task-id.ts:17`,
   `turn-id.ts:16`). Ejemplo:

   ```typescript
   const normalised = Id.normalize(raw, "decision_id");
   return new DecisionId(normalised as IdValue<DecisionIdBrand>);
   ```

   El cast es estructuralmente necesario: `Id.normalize()` devuelve
   `string` (no puede saber a qué brand le aplica), y el constructor
   exige `IdValue<TBrand>`. El cast es seguro porque `normalize` ya
   validó UUID v7. Es exactamente el mismo patrón de `WorkspaceId`
   en `shared/` y fue APROBADO en Tarea 1.

3. **Discriminated union narrowing en `RelationEndpoint.toValue()`**
   (`relation-endpoint.ts:120,123,126,128`):

   ```typescript
   if (this.kind === "decision") {
     return { kind: "decision", id: this.id as DecisionId };
   }
   ```

   El cast existe porque la clase guarda `kind` y `id` en **dos
   campos separados**, así que el narrowing por `this.kind ===
   "decision"` no propaga a `this.id` (TS no soporta correlated
   refinements entre campos). Es **runtime-seguro** porque las cuatro
   factories (`decision()`, `learning()`, `entity()`, `task()`)
   garantizan el invariante. Ver advertencia A4 abajo: el código se
   beneficiaría de almacenar la unión discriminada directamente.

**Cero `any` en posición de tipo. Cero `ts-ignore`. Cero supresión de
linter. Cero lectura de wall-clock o RNG no inyectado.**

### Auditoría de modularidad estricta (§1.5)

`grep -rEn "^import" code/src/modules/memory/domain/` produce
**52 imports**, todos clasificables en exactamente dos categorías:

1. **Imports relativos a `../../../../shared/domain/...`** —
   `non-empty-string.ts`, `id.ts`, `branded.ts`, `domain-event.ts`,
   `confidence.ts`, `tags.ts`, `tokens.ts`, `timestamp.ts`,
   `workspace-id.ts`, `domain-error.ts`, `invalid-input-error.ts`,
   `json-rpc-error-codes.ts`. **PERMITIDOS** por §1.5.
2. **Imports intra-módulo** (`./decision-id.ts`,
   `../value-objects/...`, `../events/...`, `../errors/...`,
   `../aggregates/...`). **PERMITIDOS** por §1.5.

**Cero imports** desde `modules/workspace/`, `modules/retrieval/`,
`modules/curator/`, `modules/encryption/`, `modules/secrets/`,
`modules/mcp-server/`, `modules/connectors/`, `modules/cli/`. La regla
de modularidad estricta se cumple sin excepciones.

```bash
$ grep -rEn "from \"" code/src/modules/memory/domain/ \
    | grep -E "modules/(workspace|retrieval|curator|encryption|secrets|mcp-server|connectors|cli|background|persistence|telemetry)"
# (vacío)
```

---

## Hallazgos

### CRÍTICOS (bloquean aprobación)

**Ninguno.** El código cumple §1.4 (SOLID), §1.5 (modularidad estricta)
y §1.6 (type-safety total) sin violaciones bloqueantes.

### ADVERTENCIAS (no bloqueantes — preventivas / estilísticas)

#### A1. SRP / tamaño — los 7 aggregates rozan o superan el umbral heurístico

Conteo bruto:

| Aggregate | Líneas | Métodos públicos | Mutaciones reales | Comentario |
|---|---|---|---|---|
| `turn.ts` | 156 | 10 | 1 (`record`) | OK — el resto son getters/factories |
| `relation.ts` | 175 | 10 | 0 (sólo factories) | OK — edge sin estado mutable |
| `session.ts` | 274 | 13 | 2 (`recordActivity`, `end`) | umbral excedido |
| `entity.ts` | 274 | 18 | 2 (`markUsed`, `updateDescription`) | umbral excedido |
| `learning.ts` | 274 | 19 | 2 (`markUsed`, `consolidateInto`) | umbral excedido |
| `decision.ts` | 331 | 21 | 2 (`supersede`, `markUsed`) | umbral excedido |
| `task.ts` | 357 | 20 | 4 (`start`, `block`, `unblock`, `complete`) | umbral excedido |

- **Detalle:** los 7 aggregates **superan el heurístico de 7 métodos
  públicos** (decision tiene 21, learning 19, task 20). Sin embargo,
  el desglose muestra que **17 de los 21 métodos públicos de
  `Decision` son getters/`isActive`/`pullEvents`** (memory boilerplate
  obligatorio para que la capa application pueda leer el estado sin
  poke). Sólo 4 son comportamiento real (`record`, `rehydrate`,
  `supersede`, `markUsed`). Mismo patrón en los demás. La razón de
  cambio es **única** por aggregate: cambian las reglas de "ese kind
  de memory" — el state machine de tasks, el linaje de decisions, el
  timer de sessions, etc.
- **Conclusión:** SRP **no** violado. La métrica supera el umbral por
  un patrón estructural inevitable en un aggregate root con exposición
  read-only completa para la capa application. Ya documentado en el
  validator de Tarea 2 (workspace) y aplica idéntico aquí.
- **Fix sugerido (preventivo):** si la capa de presentation/application
  termina necesitando proyecciones (DTOs serializables), **NO** mover
  los getters al aggregate; introducir un `MemoryProjection` o un
  mapper en application. El aggregate queda libre de responsabilidades
  de serialización.

#### A2. OCP / discriminated union — `RelationEndpoint` desperdicia el discriminador en runtime

- **Archivo:** `code/src/modules/memory/domain/value-objects/relation-endpoint.ts:54-58`
- **Detalle:** La clase declara dos campos paralelos:

  ```typescript
  private constructor(
    public readonly kind: RelationEndpointKind,
    private readonly id: DecisionId | LearningId | EntityId | TaskId,
  ) {}
  ```

  El acoplamiento entre `kind` y `id` se **mantiene como invariante
  manual** (las 4 factories estáticas se aseguran de no romperlo) pero
  **el sistema de tipos no lo conoce**. Esto fuerza los 4 casts ` as
  DecisionId | LearningId | EntityId | TaskId` en `toValue()`
  (líneas 120-128) y deja la puerta abierta a que un futuro
  desarrollador agregue una nueva factory que pase la combinación
  inválida (e.g. `kind="decision"` con un `LearningId`).
- **Conclusión:** No es violación bloqueante de OCP — agregar un
  nuevo `RelationEndpointKind` (e.g. `"turn"`) sigue siendo
  "agregar a la lista + agregar factory", sin tocar lógica
  existente. Pero el invariante "kind matches id" se lleva a runtime
  por convención, no por tipos.
- **Fix sugerido (preventivo):** almacenar directamente la unión
  discriminada como **único campo**:

  ```typescript
  private constructor(
    private readonly value:
      | { readonly kind: "decision"; readonly id: DecisionId }
      | { readonly kind: "learning"; readonly id: LearningId }
      | { readonly kind: "entity"; readonly id: EntityId }
      | { readonly kind: "task"; readonly id: TaskId },
  ) {}

  public get kind(): RelationEndpointKind { return this.value.kind; }
  public toValue(): RelationEndpointValue { return this.value; }
  ```

  Cero casts, narrowing exhaustivo, invariante imposible de romper.
  La factory `create(rawKind, rawId)` queda igual. Ahorra 4 líneas
  y elimina los únicos casts no-canónicos del módulo.

#### A3. ISP — `DecisionRepository.findActiveByTags` recibe `Tags` cuando podría recibir `readonly Tag[]`

- **Archivo:** `code/src/modules/memory/domain/repositories/decision-repository.ts:63-66`
- **Detalle:** El método pide un `Tags` (`shared/domain`), que es el
  VO completo con sus invariantes propias (orden, dedup, etc.). El
  consumer típicamente quiere "estas N tags al menos" sin importar
  la representación canónica del VO. Hacer que el repo acepte una
  collection más débil (e.g. `readonly Tag[]` o `Iterable<Tag>`)
  bajaría la fricción de uso. No bloquea — es semántico, y `Tags`
  ya garantiza dedup, lo que es positivo.
- **Conclusión:** No es violación de ISP en el sentido de "interface
  hinchada" (el repo tiene 4 métodos cohesivos). Es una micro-fricción
  de DX.
- **Fix sugerido (opcional):** mantener `Tags` para consistencia con
  el aggregate `Decision.getTags(): Tags`. Si la fricción aparece en
  use cases, agregar una factory `Tags.fromList(tags: readonly
  Tag[]): Tags` en `shared`.

#### A4. SRP / convención — `Session.validateIdleTimeout` corre 2 veces (factory + rehydrate)

- **Archivo:** `code/src/modules/memory/domain/aggregates/session.ts:98,127`
- **Detalle:** Tanto `start()` como `rehydrate()` invocan
  `validateIdleTimeout(input.idleTimeoutMs)`. La validación de
  rehydrate es defensiva: si la persistencia entrega un valor
  malformado, la app debería fallar al cargar más que al usar. Pero
  el patrón general en este módulo (y en `workspace/`) es **trust
  persisted state on rehydrate**: `Decision.rehydrate` no re-valida
  nada, ni `Relation.rehydrate` chequea self-loop. Esto es
  inconsistente.
- **Conclusión:** No bloqueante; ambas decisiones (validar siempre
  vs. confiar en persistencia) son defendibles, pero conviene elegir
  una y aplicarla uniformemente.
- **Fix sugerido (consistencia):**
  - **Opción 1 (más estricta):** validar en TODOS los `rehydrate` de
    todos los aggregates. Esto detecta corrupción al cargar.
  - **Opción 2 (más performante, más pura):** confiar en persistencia
    en `rehydrate` (eliminar `validateIdleTimeout` de
    `Session.rehydrate` línea 127). Esto coincide con
    `Decision.rehydrate` y `Relation.rehydrate` y deja la integridad
    para el adapter / tests.

  Recomendación: **Opción 1** — es barata (un Number.isFinite +
  Number.isInteger + comparación) y la única defensa que tendrá el
  dominio si la migración del adapter introduce un valor malformado.
  Aplicar el patrón a `Decision.rehydrate` (validar `confidence`,
  `useCount` ya vienen como VOs validadas, así que el costo es
  mínimo) y `Relation.rehydrate` (validar self-loop).

### POSITIVOS

#### SOLID (§1.4)

- **SRP** — Cada uno de los **28 VOs** encapsula UN concepto:
  IDs branded (`DecisionId`, `LearningId`, `EntityId`, `TaskId`,
  `TurnId`, `SessionId`, `RelationId`), enums DU (`Actor`,
  `EntityKind`, `DecisionStatus`, `EmbeddingStatus`,
  `LearningSeverity`, `TaskStatus`, `TaskPriority`, `RelationKind`,
  `RelationEndpointKind`, `ScopeKind`), composite VOs (`Scope`,
  `LastUsed`, `RelationEndpoint`, `SupersededBy`, `UseCount`),
  strings tipados (`DecisionTitle`, `Rationale`, `LearningText`,
  `EntityName`, `EntityDescription`, `TaskTitle`,
  `TaskDescription`, `TurnContent`). Cero VOs "swiss army knife".

  Cada uno de los **10 errores** representa UNA falla específica con
  su `code` estable y su `jsonRpcCode` documentado:
  `DecisionNotActive`, `DecisionSelfSupersession`,
  `InvalidTaskTransition`, `LearningAlreadyConsolidated`,
  `LearningSelfConsolidation`, `NonMonotonicActivity`,
  `RelationSelfLoop`, `SessionAlreadyEnded`,
  `SessionIdleTimeoutExceeded`, más la abstracta `MemoryDomainError`.

  Cada uno de los **18 events** captura UN hecho del pasado:
  `DecisionRecorded`, `DecisionSuperseded`, `DecisionUsed`,
  `EntityDescribed`, `EntityRegistered`, `EntityUsed`,
  `LearningConsolidated`, `LearningRegistered`, `LearningUsed`,
  `RelationCreated`, `SessionEnded`, `SessionStarted`,
  `TaskBlocked`, `TaskCompleted`, `TaskCreated`, `TaskStarted`,
  `TaskUnblocked`, `TurnRecorded`. Todos `eventName` literales del
  formato `"memory.<kebab-past-tense>"`, todos con campos `readonly`.

- **OCP** — Cero `if (kind === "X") { ... } else if (kind === "Y") {
  ... }` proliferando. Patrones aplicados:
  - **Tabla de transiciones** en `task.ts:44-51`
    (`ALLOWED_TASK_TRANSITIONS: Readonly<Record<TaskStatusKind,
    ReadonlyArray<TaskStatusKind>>>` con `Object.freeze`).
    Agregar un nuevo status es 1 línea en el enum + 1 fila en la
    tabla. La función `assertTransitionLegal` (línea 341) no
    crece.
  - **`Object.freeze` ranks** en `task-priority.ts:23-29` y
    `learning-severity.ts:19-24` para ordenamiento numérico
    sin string-comparison. Agregar `"emergency"` a priority es
    array + freeze + factory + entrada en `PRIORITY_RANK` —
    ningún `if` se modifica.
  - **Predicados encapsulados** en cada DU VO
    (`isActive()`, `isSuperseded()`, `isUser()`, `isAssistant()`,
    `isPending()`, `isReady()`, `isFailed()`, `isTip()`,
    `isWarning()`, `isCritical()`, `isTodo()`, `isInProgress()`,
    `isDone()`, `isBlocked()`, `isOpen()`, `isProject()`,
    `isModule()`, `hasBeenUsed()`). El consumer pregunta por
    **capacidad**, no por tag.
  - **DU exhaustivas** en `Scope.toValue(): ScopeValue` y
    `LastUsed.toValue(): LastUsedValue` con narrowing por `kind`
    + null check defensivo.
  - **Pattern A3 de Tarea 2 aplicado**: TODOS los enums string
    derivan la unión literal desde el array `as const`:
    ```typescript
    const TASK_STATUS_KINDS = ["todo", "in_progress", "done", "blocked"] as const;
    export type TaskStatusKind = (typeof TASK_STATUS_KINDS)[number];
    ```
    Una sola fuente de verdad por enum. Imposible que la unión y la
    lista de validación drifteen.

- **LSP** — Los 8 VOs string heredan de `NonEmptyString`
  (`DecisionTitle`, `Rationale`, `LearningText`, `EntityName`,
  `EntityDescription`, `TaskTitle`, `TaskDescription`,
  `TurnContent`). Cada uno **estrecha** la postcondición vía
  `NonEmptyString.normalize(raw, "field")` + validación adicional
  (length cap, no-newlines según corresponda). Ninguno **debilita**
  pre/postcondiciones del padre. La equality heredada
  (`other.constructor !== this.constructor` en
  `non-empty-string.ts:66`) es sibling-safe: dos `DecisionTitle`
  con el mismo texto son iguales, pero un `DecisionTitle` y un
  `TaskTitle` con el mismo texto no.

  Los 7 IDs heredan de `Id<TBrand>`. Cada uno provee su propia
  factory `from(raw: string)` con su `fieldName` específico, sin
  alterar los invariantes UUID v7 + lowercase del padre.

  Los 9 errores concretos heredan de `MemoryDomainError`
  → `DomainError` → `Error` sin estrechar nada. El catch genérico
  `instanceof MemoryDomainError` o `instanceof DomainError`
  capturará a todos sin sorpresas.

- **ISP** — Los 7 repositorios son interfaces pequeñas:

  | Repo | Métodos |
  |---|---|
  | `DecisionRepository` | `findById`, `save`, `findByWorkspace`, `findActiveByTags` |
  | `EntityRepository` | `findById`, `save`, `findByWorkspace`, `findByNameAndKind` |
  | `LearningRepository` | `findById`, `save`, `findByWorkspace`, `findActiveByMinimumSeverity` |
  | `RelationRepository` | `findById`, `save`, `findFromEndpoint`, `findToEndpoint` |
  | `SessionRepository` | `findById`, `save`, `findCurrentByWorkspace` |
  | `TaskRepository` | `findById`, `save`, `findOpenByWorkspace`, `findByStatus`, `findByPriority` |
  | `TurnRepository` | `findById`, `save`, `findBySession` |

  Promedio ≈ 3.7 métodos. Máximo 5 (`TaskRepository`). Ninguna
  fuerza al implementador a métodos que no aplican (no hay `throw
  new Error("not supported")` defensivos).

- **DIP** — Los 7 aggregates **NO instancian adapters**: reciben
  todos los puertos y datos por parámetro (incluido `occurredAt:
  Timestamp`). Los aggregates llaman a sus colaboradores
  (`UseCount.zero()`, `LastUsed.never()`, `LastUsed.touch(at)`,
  `DecisionStatus.active()`, `TaskStatus.todo()`, `SessionEnded(...)`,
  `RelationCreated(...)`) que son VOs y eventos del propio dominio,
  no clases de infraestructura. **Cero `new SqliteX`, cero `new
  HttpY`, cero `import { ... } from '../infrastructure'`** en
  ningún archivo del scope.

  El dominio nunca lee el reloj — `Timestamp` siempre llega como
  `occurredAt` por parámetro inyectado por la composition root vía
  el puerto `Clock` (validado en Tarea 1). `Math.random`,
  `crypto.*`, `process.*`, `console.*`, `Date.now`, `new Date()` —
  todos cero matches en el scope.

  Las interfaces `*Repository` son puertos puros (no abstract
  classes con default methods, no factory functions exportadas);
  declaran **contrato**, las implementaciones viven en
  `infrastructure/persistence/`.

#### Modularidad estricta (§1.5)

- **Cero imports cross-módulo.** Los 52 imports listados van
  exclusivamente a `shared/domain/...` o a paths intra-módulo
  (`../value-objects/`, `../events/`, `../errors/`, `./...`).
- **Estructura interna correcta**: `value-objects/`,
  `aggregates/`, `events/`, `repositories/`, `errors/`. No hay
  `services/` (correcto: el módulo no tiene aún lógica
  cross-aggregate).
- **El aggregate importa puertos como `interface` puros** —
  `DecisionRepository`, `LearningRepository`, etc., son
  interfaces declaradas dentro del propio módulo (no en
  `shared/`), porque son específicas del bounded context. Esto
  es correcto según §1.5.
- **El aggregate importa VOs cross-aggregate del propio módulo**
  vía `import type` (`Tags`, `Confidence`, `Timestamp`,
  `WorkspaceId` desde `shared/`; `SessionId`, `EmbeddingStatus`,
  `Scope`, `LastUsed`, etc. desde el propio módulo). El uso
  consistente de `import type` para todo lo que no necesita ser
  evaluado en runtime ayuda al tree-shaker y al build paralelo.

#### Type-safety total (§1.6)

- **Cero `any`** en posición de tipo (verificado por grep + por
  que `tsc --strict --noImplicitAny` pasa limpio).
- **Casts (` as `) sólo canónicos**: `as const` para arrays
  literales (10 ocurrencias) + brand attribution en los 7 IDs +
  4 casts en `RelationEndpoint.toValue()` (ver A2 — runtime-seguros
  pero con room for improvement). **Cero `as any`, cero `as
  unknown`, cero `as Type` arbitrario.**
- **Cero `// @ts-ignore` / `// @ts-nocheck` /
  `// @ts-expect-error`**.
- **Cero `eslint-disable` o equivalente.**
- **Tipos de retorno explícitos** en TODA función/método de la
  superficie pública: factories (`Decision.record(input): Decision`,
  `Learning.register(input): Learning`, etc.), helpers privados
  (`Session.validateIdleTimeout(value: number): void`,
  `Task.assertTransitionLegal(target: TaskStatus): void`,
  `Scope.normalizeModule(raw: string): string`), getters
  (`getId(): DecisionId`), predicates (`isActive(): boolean`),
  `pullEvents(): readonly DomainEvent[]`. Cero inferencia
  implícita en superficie pública. Las únicas arrows sin return
  type explícito son inline callbacks de `Array.map` para
  templating (`TASK_STATUS_KINDS.map((k) => `"${k}"`)`) — patrón
  tolerado por `explicit-function-return-type` cuando es expresión
  de retorno literal.
- **`exactOptionalPropertyTypes` honrado** — todos los constructores
  de error usan el patrón
  `options !== undefined ? { cause: options.cause } : undefined`
  (verificado en los 9 errores concretos). Los aggregates usan
  `sessionId: SessionId | null` explícito (no `?:` opcional) para
  que el null sea **dato explícito**, no propiedad ausente.
- **`noUncheckedIndexedAccess` honrado** — Los type guards `isKind`
  iteran con index check defensivo:
  ```typescript
  for (let i = 0; i < SCOPE_KINDS.length; i += 1) {
    const known = SCOPE_KINDS[i];
    if (known !== undefined && known === candidate) return true;
  }
  ```
  El acceso a `ALLOWED_TASK_TRANSITIONS[this.status.kind]` en
  `task.ts:345` es seguro porque `this.status.kind: TaskStatusKind`
  pertenece a la unión cerrada del Record (TS lo sabe). El acceso
  a `SEVERITY_RANK[this.kind]` y `PRIORITY_RANK[this.kind]` ídem.
- **`noPropertyAccessFromIndexSignature` honrado** — los Records
  con index signature (`ALLOWED_TASK_TRANSITIONS`, `SEVERITY_RANK`,
  `PRIORITY_RANK`) se acceden con bracket notation, nunca con dot
  notation que tsc rechazaría.
- **`noImplicitOverride` honrado** — ninguna subclase usa
  `override` implícito. Los 8 VOs string que heredan de
  `NonEmptyString` no overridean métodos del padre (sólo agregan
  su factory `from(raw)`). Los 7 IDs no overridean `Id`. Los 9
  errores no overridean métodos de `MemoryDomainError`.
- **`noImplicitReturns` honrado** — todas las funciones con tipo
  de retorno no-`void` retornan en TODOS los caminos. Verificado
  por tsc.
- **Discriminated unions correctos:**
  - `DecisionStatusKind = "active" | "superseded"` — guard
    `isKind`, predicates `isActive`/`isSuperseded`.
  - `LearningSeverityKind = "tip" | "warning" | "critical"` —
    + ranking numérico encapsulado.
  - `EntityKindValue = "function" | "class" | "module" | "service"
    | "library" | "concept" | "person" | "team"` — guard
    `isValue`.
  - `TaskStatusKind = "todo" | "in_progress" | "done" | "blocked"`
    — + matriz de transiciones.
  - `TaskPriorityKind = "low" | "medium" | "high" | "critical"` —
    + ranking numérico.
  - `ActorKind = "user" | "assistant"` — predicates
    `isUser`/`isAssistant`.
  - `EmbeddingStatusKind = "pending" | "ready" | "failed"` —
    predicates por estado.
  - `RelationKindValue = "references" | "supersedes" |
    "depends_on" | "related_to"` — factories estáticas por
    cada valor.
  - `ScopeValue` — DU exhaustiva con narrowing por `kind`:
    `{ kind: "project"; module: null } | { kind: "module";
    module: string }`.
  - `LastUsedValue` — DU sobre `kind`:
    `{ kind: "never"; at: null } | { kind: "at"; at: Timestamp }`.
  - `RelationEndpointValue` — DU sobre `kind` con id tipado por
    variante (ver A2 sobre la representación interna).
  - `eventName` literal en cada uno de los 18 eventos
    (`"memory.decision-recorded"`, `"memory.task-blocked"`, etc.)
    → un subscriber puede hacer `switch (event.eventName)` con
    narrowing exhaustivo entre los 4 módulos (workspace + memory +
    futuros).
- **Branded types con narrowing correcto** —
  `DecisionId extends Id<DecisionIdBrand>`, etc. El compilador
  rechaza pasar un `LearningId` donde se espera `DecisionId`.
  `RelationEndpoint.create(rawKind, rawId)` enruta al constructor
  correcto según el discriminator runtime.
- **Inmutabilidad disciplinada**:
  - `private constructor` en TODOS los VO concretos (28/28).
  - `readonly` en TODOS los campos públicos de eventos (18/18) y
    de errores (los `decisionId`, `learningId`, etc. son
    `readonly`).
  - Los aggregates usan `readonly` en campos que no cambian
    (`id`, `workspaceId`, `createdAt`, `events: DomainEvent[]`)
    y campos privados mutables sólo donde el comportamiento lo
    exige (`status`, `useCount`, `lastUsed`, `updatedAt`,
    `completedAt`, etc.).
  - `Object.freeze` en `ALLOWED_TASK_TRANSITIONS`, `SEVERITY_RANK`,
    `PRIORITY_RANK`, y en el array retornado por cada
    `pullEvents()` (defensa runtime).
  - `Tags`, `Confidence`, `Tokens`, `Timestamp`, `Scope`,
    `LastUsed`, `UseCount` son todos VOs inmutables — los
    aggregates los reemplazan completamente
    (`this.useCount = this.useCount.increment()`,
    `this.lastUsed = this.lastUsed.touch(at)`,
    `this.status = TaskStatus.done()`) en vez de mutar internamente.
- **`pullEvents` devuelve `readonly DomainEvent[]`** (no
  `DomainEvent[]`) para evitar que el caller mute el buffer. El
  `Object.freeze` sobre el snapshot drenado es defensa adicional
  en runtime. El método **drena** el buffer
  (`this.events.length = 0`) — segunda llamada devuelve
  `Object.freeze([])`.
- **JSDoc de invariantes** en TODOS los archivos — cada VO declara
  invariantes y semántica de equality. Cada aggregate documenta
  pre/postcondiciones de cada mutation. Cada error documenta su
  `code`, su `jsonRpcCode` (cuando aplica) y por qué se eligió ese
  mapeo.
- **Trazabilidad a docs**: cada archivo cita la sección relevante
  de `docs/03-modelo-datos.md`, `docs/02-protocolo-mcp.md`,
  `docs/01-arquitectura.md`, `docs/04-capas-contexto.md`. El
  agente architect podrá auditar la coherencia
  modelo↔documento sin inferencia.
- **Errores wrappean `cause` con `Object.defineProperty`** vía la
  base `DomainError` (heredado de Tarea 1) — sin polyfill,
  `enumerable: false` para no contaminar logs.
- **`code` como `readonly`** en todos los errores concretos con
  identificadores estables kebab-case
  (`memory.decision-not-active`, `memory.invalid-task-transition`,
  `memory.relation-self-loop`, `memory.session-idle-timeout-exceeded`,
  etc.).
- **`jsonRpcCode` explícito** en todos los errores
  (`SessionIdleTimeoutExceededError` mapea a
  `JsonRpcErrorCodes.SESSION_EXPIRED = -32101`; los demás declaran
  `null` con justificación documentada).

---

## Veredicto justificado

**APROBADO.**

Los **70 archivos** del scope cumplen los lineamientos §1.4 (SOLID),
§1.5 (modularidad estricta) y §1.6 (type-safety total) **sin
excepciones bloqueantes**. La compilación con `tsc --strict` y los 17
flags exigidos pasa con cero errores y cero warnings sobre el corpus
completo (100 archivos: shared/ + workspace/ + memory/).

**Cumplimiento type-safety total (§1.6):**
- Cero `any`, cero `as any`, cero `// @ts-ignore`,
  cero `// @ts-nocheck`, cero `// @ts-expect-error`,
  cero `eslint-disable`.
- Cero lectura de wall-clock (`Date.now`, `new Date()`),
  cero RNG (`Math.random`, `crypto.*`), cero side effects
  (`console.*`, `process.*`).
- Branded types correctos en los 7 IDs.
- Discriminated unions exhaustivas en los 11 enums string + 3
  composites (`Scope`, `LastUsed`, `RelationEndpoint`).
- Tipos de retorno explícitos en toda función/método.
- `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`,
  `noPropertyAccessFromIndexSignature`, `noImplicitOverride`
  honrados.

**Cumplimiento SOLID (§1.4):**
- **SRP**: cada uno de los 70 archivos tiene UNA razón de cambio.
  Los aggregates rozan umbrales heurísticos de líneas/métodos pero
  17 de cada 21 métodos públicos son getters obligatorios para la
  capa application — patrón estructural inevitable, ya documentado
  en validator de Tarea 2.
- **OCP**: tabla de transiciones para tasks, ranking encapsulado
  para severities/priorities, predicates encapsulados para todos
  los DUs. Pattern A3 de Tarea 2 aplicado uniformemente: todos los
  enums string usan `array as const → union derivada`. Cero
  switches gigantes, cero proliferación de `if (kind === "X")`.
- **LSP**: las 8 subclases de `NonEmptyString` y los 7 hijos de
  `Id<TBrand>` estrechan correctamente sin debilitar el contrato
  del padre. Los 9 errores concretos son sustituibles por
  `MemoryDomainError` → `DomainError`.
- **ISP**: los 7 repositorios promedian 3.7 métodos (rango 3-5).
  Ninguna interface obliga a métodos no aplicables.
- **DIP**: los 7 aggregates no instancian adapters, reciben todo
  por parámetro inyectado, no leen reloj. Los 7 repositorios son
  interfaces puras.

**Cumplimiento modularidad estricta (§1.5):**
- Cero imports cross-módulo (verificado por grep). Los 52 imports
  van exclusivamente a `shared/domain/...` o intra-módulo.
- Estructura interna correcta:
  `value-objects/aggregates/events/repositories/errors`.

**Las 4 advertencias listadas son sugerencias estilísticas /
preventivas:**

- **A1** observa que los 7 aggregates superan los umbrales heurísticos
  de líneas (>200) y métodos públicos (>7), pero la mayoría son
  getters/predicates (≈80%) requeridos para que la capa application
  pueda leer estado sin poke. Patrón estructural inevitable.
- **A2** propone refactorizar `RelationEndpoint` para almacenar la
  unión discriminada como un único campo, eliminando los 4 únicos
  casts ` as Type` no canónicos del módulo y haciendo imposible
  romper el invariante "kind matches id" en compile-time.
- **A3** sugiere relajar el tipo del parámetro `requiredTags` en
  `DecisionRepository.findActiveByTags` de `Tags` a una colección
  más débil. No bloquea — es DX.
- **A4** observa la inconsistencia entre `Session.rehydrate`
  (re-valida `idleTimeoutMs`) y `Decision.rehydrate` /
  `Relation.rehydrate` (confían en persistencia). Recomienda elegir
  una política y aplicarla uniformemente — preferentemente validar
  siempre.

Ninguna advertencia afecta corrección actual ni viola ningún
lineamiento.

El cumplimiento DIP es ejemplar: ningún aggregate instancia adapters,
todos los puertos son interfaces puras declaradas en el dominio del
propio módulo (correcto: son específicas del bounded context), y
todos los timestamps llegan como parámetro inyectado por la
composition root. El cumplimiento de la regla de modularidad estricta
(§1.5) es absoluto: cero imports cross-módulo, todo va a
`shared/domain/` o intra-módulo.

El módulo `memory/domain` está listo para que la fase de
infraestructura implemente los adapters (los 7 `Sqlite*Repository`
en `infrastructure/persistence/`) y para que la fase de application
monte los use cases (`RememberDecisionUseCase`,
`RememberLearningUseCase`, `RememberEntityUseCase`,
`RememberTurnUseCase`, `CreateTaskUseCase`,
`TransitionTaskStatusUseCase`, `RecallUseCase`,
`SupersedeDecisionUseCase`, `ConsolidateLearningUseCase`,
`CreateRelationUseCase`, `StartSessionUseCase`,
`EndSessionUseCase`).

---

## Próximo paso recomendado

1. **Liberar `domain-architect` para Tarea 4 de Fase 1** (los puertos
   compartidos restantes en `shared/application/ports/` que aún no se
   hayan validado: `Clock`, `IdGenerator`, `Logger`, `Database`,
   `Embedder`, `KDF`), o pasar al siguiente bounded context según el
   plan de fases.
2. **Considerar A2** antes de cerrar la fase: refactorizar
   `RelationEndpoint` para usar un único campo con la unión
   discriminada elimina los 4 casts no canónicos, hace el invariante
   inviolable en compile-time y reduce el archivo en ~10 líneas. Es
   barato.
3. **Considerar A4**: elegir la política de validación en
   `rehydrate` y aplicarla uniformemente. Recomendado: validar
   siempre (Opción 1) — defensa contra corrupción de migración.
4. La **Fase de QA** debe agregar tests unitarios de cobertura
   completa sobre invariantes específicas:
   - **Matriz de transiciones de Task**: TODAS las 16 combinaciones
     `(from, to)` — las 7 legales (`todo→in_progress`,
     `todo→blocked`, `in_progress→done`, `in_progress→blocked`,
     `blocked→in_progress`, `blocked→todo`) deben emitir el evento
     correcto y mover el estado; las 9 ilegales
     (todas las que tienen `done` como `from`, `todo→done`,
     `blocked→done`, todos los self-transitions) deben lanzar
     `InvalidTaskTransitionError`.
   - **Session lifecycle**: `recordActivity` con timestamp anterior
     debe lanzar `NonMonotonicActivityError`; con delta > timeout
     debe lanzar `SessionIdleTimeoutExceededError` (-32101);
     `end()` doble debe lanzar `SessionAlreadyEndedError`;
     `recordActivity` después de `end()` debe lanzar
     `SessionAlreadyEndedError`; `end()` con timestamp anterior a
     `lastActivityAt` debe lanzar `NonMonotonicActivityError`.
   - **Decision supersession**: self-supersession lanza
     `DecisionSelfSupersessionError`; doble supersession lanza
     `DecisionNotActiveError`; `markUsed` sobre superseded NO
     lanza (intencional, ver línea 237-241 de aggregate).
   - **Learning consolidation**: self-consolidation lanza
     `LearningSelfConsolidationError`; doble consolidation lanza
     `LearningAlreadyConsolidatedError`.
   - **Relation self-loop**: cubrir las 4 combinaciones
     `(decision, decision)`, `(learning, learning)`,
     `(entity, entity)`, `(task, task)` con misma id en `from`/`to`.
   - **VOs branded**: pasar un `LearningId` donde se espera
     `DecisionId` debe ser **error de compilación** (test de
     `tsc --noEmit` con archivo de prueba que rompa).
   - **Scope**: `Scope.create("module", null)` debe lanzar;
     `Scope.create("project", "anything")` debe ignorar el
     module name silenciosamente.
   - **LastUsed.millisecondsSince**: con `now < at` debe devolver
     0 (clamp); con `at === null` (`kind === "never"`) debe
     devolver `null` explícito.
   - **UseCount**: `of(-1)`, `of(1.5)`, `of(NaN)`, `of(Infinity)`
     deben lanzar `InvalidInputError`.
   - **NonEmptyString subclasses**: cada subclase rechaza string
     vacío, string sólo whitespace, string sobre el cap, y
     `DecisionTitle`/`EntityName`/`TaskTitle` rechazan newlines.
   - **`pullEvents` idempotencia**: segunda llamada devuelve
     array vacío frozen.
5. La **Fase de architect** debe verificar que los 7
   `Sqlite*Repository` en infrastructure implementen los contratos
   sin debilitarlos (LSP a nivel de adapters), y que no haya `new
   SqliteX` en ningún use case (DIP a nivel de application).
