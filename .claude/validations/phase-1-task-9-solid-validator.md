# SOLID + Type-Safety Validation — Phase 1, Task 9: curator/domain
**Validator:** solid-validator
**Date:** 2026-04-27
**Verdict:** APROBADO (sin advertencias bloqueantes; 2 sugerencias menores)

---

## 0. Scope

`code/src/modules/curator/domain/` — **33 archivos** organizados en:

| Subcarpeta | Archivos | Detalle |
|---|---:|---|
| `aggregates/` | 1 | `curator-run.ts` |
| `services/` | 4 | `decay-calculator.ts` (static-only class), `entry-collector.ts`, `consolidation-detector.ts`, `path-checker.ts` (3 driven ports) |
| `value-objects/` | 17 | `affected-entry-ref`, `consolidation-pair`, `consolidation-threshold`, `cosine-score`, `curator-run-id`, `curator-run-stats`, `curator-run-trigger`, `decay-factor`, `health-finding`, `health-finding-kind`, `health-severity`, `max-entries-per-kind`, `memory-entry-kind`, `path-staleness`, `prune-threshold`, `pruned-entry`, `pruned-reason` |
| `events/` | 5 | `curator-run-started`, `curator-run-completed`, `entry-pruned`, `health-finding-detected`, `learnings-consolidated` |
| `repositories/` | 2 | `curator-run-repository.ts`, `pruned-entry-repository.ts` |
| `errors/` | 4 | `curator-domain-error` (abstract base) + 3 concretos: `curator-run-already-completed-error`, `invalid-consolidation-pair-error`, `invalid-decay-factor-error` |

Lineamientos: `docs/12-lineamientos-arquitectura.md` §1.4 (SOLID), §1.5
(modularidad — alcance ampliado por orquestador via `depends_on:
["shared-domain", "memory-domain"]` en `.claude/workflow-state.json`),
§1.6 (cero `any`, type-safety total).

---

## 1. `tsc --noEmit` con flags estrictas

**PASS — exit code 0, cero errores, cero warnings.**

Comando ejecutado (TypeScript 5.6.3, scratch project en
`/tmp/solidcheck-curator`):

```bash
npx -y -p typescript@5.6.3 tsc --noEmit -p tsconfig.json
# REAL_EXIT=0
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
`code/src/modules/memory/domain/**/*.ts` (83 archivos) +
`code/src/modules/curator/domain/**/*.ts` (33 archivos) = **130
archivos**.

Resultado: **`exit=0`**. Los 33 archivos del scope `curator/domain`
compilan limpio contra los 14 archivos de `shared/domain` y los 83
archivos de `memory/domain` (que ya están validados en Tareas 1 y 3)
bajo el régimen estricto completo.

---

## 2. Auditoría grep complementaria

| Patrón | Matches en `curator/domain/` |
|---|---|
| `: any` (anotación de tipo) | **0** (1 falso-positivo en JSDoc `aggregates/curator-run.ts:257` — "immutable: any further `recordFinding`") |
| `as any` | **0** |
| `<any>` (type argument any) | **0** |
| `Promise<any>` | **0** |
| `Array<any>` | **0** |
| `as unknown` | **0** |
| `// @ts-ignore` | **0** |
| `// @ts-nocheck` | **0** |
| `// @ts-expect-error` | **0** |
| `eslint-disable` | **0** |
| `Date.now` / `new Date()` (en código, no comentario) | **0** |
| `Math.random` / `crypto.*` | **0** |
| `process.*` / `console.*` (en código, no comentario) | **0** |
| `node:` imports | **0** |
| `switch` statements | **0** |
| `throw new` | 45 — todos sobre `InvalidInputError`, `InvariantViolationError`, `InvalidDecayFactorError`, `InvalidConsolidationPairError`, `CuratorRunAlreadyCompletedError` (cero excepciones genéricas) |

### 2.1 Casts (`as ...`) en posición de tipo

Se encontraron **7 ocurrencias** y todas son canónicas:

1. **`MEMORY_ENTRY_KINDS = [...] as const`** (`memory-entry-kind.ts:26`)
   — patrón A3 SSOT. Deriva `MemoryEntryKindKind = (typeof
   MEMORY_ENTRY_KINDS)[number]`.
2. **`CURATOR_RUN_TRIGGERS = [...] as const`** (`curator-run-trigger.ts:16`)
   — mismo patrón. Deriva `CuratorRunTriggerKind`.
3. **`HEALTH_FINDING_KINDS = [...] as const`** (`health-finding-kind.ts:24`)
   — mismo patrón. Deriva `HealthFindingKindKind`.
4. **`HEALTH_SEVERITIES = [...] as const`** (`health-severity.ts:15`)
   — mismo patrón. Deriva `HealthSeverityKind`.
5. **`PRUNED_REASONS = [...] as const`** (`pruned-reason.ts:29`)
   — mismo patrón. Deriva `PrunedReasonKind`.
6. **`PATH_STALENESS_KINDS = [...] as const`** (`path-staleness.ts:19`)
   — mismo patrón. Deriva `PathStalenessKindKind`.
7. **`normalised as IdValue<CuratorRunIdBrand>`**
   (`curator-run-id.ts:19`) — única aplicación de brand en el scope.
   El cast es la aplicación canónica del *brand* a la salida del
   `Id.normalize()` (que devuelve `string` por contrato del shared).
   Idéntico patrón al ya aprobado para `WorkspaceId.from`,
   `DecisionId`, etc. en Tareas 1 y 3. **APROBADO**.

**Cero `as any`. Cero `as unknown`. Cero `as <Type>` arbitrario.**

### 2.2 `unknown` justificado

Se encontraron **4 ocurrencias** de `unknown` en código (no comentarios)
y todas caen dentro de la categoría permitida `cause?: unknown`:

| Archivo | Línea | Uso |
|---|---|---|
| `errors/curator-domain-error.ts` | 37 | `options?: { cause?: unknown }` (abstract base, mismo patrón que `MemoryDomainError`/`WorkspaceDomainError`/`CliDomainError`) |
| `errors/curator-run-already-completed-error.ts` | 30 | `options?: { cause?: unknown }` |
| `errors/invalid-consolidation-pair-error.ts` | 32 | `options?: { cause?: unknown }` |
| `errors/invalid-decay-factor-error.ts` | 26 | `options?: { cause?: unknown }` |

Patrón canónico heredado de la API estándar de `Error.cause` (ES2022).
**Cero `unknown` derivado en otras posiciones.** **APROBADO**.

### 2.3 Inmutabilidad disciplinada

- **`private constructor`** en TODOS los 17 VOs concretos + el
  aggregate `CuratorRun` (verificado: 17 hits) y **`protected
  constructor`** en `CuratorDomainError` (correcto para abstract base).
- **`DecayCalculator`** tiene `private constructor()` con cuerpo
  `// Static-only class.` — la clase es de hecho `final` por diseño;
  ni siquiera se puede `extends`. Mismo patrón que se usa para
  servicios de dominio puros sin estado.
- **96 ocurrencias de `readonly`** en campos públicos y privados que
  no se mutan: cobertura prácticamente exhaustiva.
- **11 invocaciones de `Object.freeze`** en getters defensivos
  (`getFindings`, `getConsolidations`, `pullEvents` en
  `CuratorRun`; `affectedEntries` en `HealthFinding`; los catalogs
  `DEFAULT_DECAY_FACTORS_PER_DAY`, `LEARNING_DECAY_FACTORS_PER_DAY`,
  `SEVERITY_RANK`, `MaxEntriesPerKind.caps`, `CuratorRunStats.toRecord`).

---

## 3. Modularidad estricta (§1.5 + alcance ampliado por orchestrator)

El orquestador (`.claude/workflow-state.json`,
`tasks.curator-domain.depends_on: ["shared-domain", "memory-domain"]`)
codifica explícitamente la excepción de §1.5 que permite a
`curator/domain` importar de `memory/domain` (precedente: misma
convención preestablecida para `retrieval/domain`).

### 3.1 Imports permitidos: `shared/domain/` y `memory/domain/`

`grep -rEn "^import" code/src/modules/curator/domain/` produce todos
imports clasificables en exactamente tres categorías:

| Origen | Cuenta | Detalle |
|---|---:|---|
| `shared/domain/` | ~25 | `InvalidInputError`, `InvariantViolationError`, `DomainError`, `Id`+`IdValue`, `Confidence`, `Timestamp`, `WorkspaceId`, `DomainEvent` |
| `memory/domain/` | 3 | `LearningSeverity` (value, `decay-factor.ts:1`), `LearningSeverity` (type, `decay-calculator.ts:3`), `Learning` (type, `consolidation-detector.ts:1`) |
| Intra-módulo (`./` o `../...`) | ~50 | Sólo entre archivos del propio `curator/domain/` |

### 3.2 Cross-imports prohibidos: confirmados ausentes

```bash
$ grep -rEn "from \".*modules/(workspace|retrieval|encryption|secrets|mcp-server|cli|connectors)" \
    code/src/modules/curator/domain/
# (vacío)
```

**Cero imports** desde `modules/workspace/`, `modules/retrieval/`,
`modules/encryption/`, `modules/secrets/`, `modules/mcp-server/`,
`modules/cli/`. Cero imports desde `memory/application/`,
`memory/infrastructure/`, `memory/presentation/` — el alcance
ampliado por el orquestador SÓLO autoriza `memory/domain/`, y eso es
exactamente lo que se importa.

### 3.3 Imports cross-módulo `memory/domain` — auditoría exacta

| # | Archivo | Línea | Símbolo | Forma | Justificación |
|---|---|---|---|---|---|
| 1 | `value-objects/decay-factor.ts` | 1 | `LearningSeverity` | `import { ... }` (value) | El catálogo `LEARNING_DECAY_FACTORS_PER_DAY` declara su tipo via `Record<ReturnType<LearningSeverity["toString"]>, number>` (línea 54) y el método `forKind(kind, severity)` recibe `severity: LearningSeverity \| null` (línea 114). El factor de decay para learnings depende explícitamente del enum `severity` definido en el bounded context `memory/`. Mover el VO a `shared/` rompería el "Ubiquitous Language": `LearningSeverity` ES propiedad del kind `learning`, que vive en `memory/`. La excepción está autorizada por el orquestador. |
| 2 | `services/decay-calculator.ts` | 3 | `LearningSeverity` | `import type { ... }` | Mismo motivo: la signatura `newConfidence({ severity: LearningSeverity \| null, ... })` lo exige. El `import type` es óptimo (sólo se usa en posición de tipo). |
| 3 | `services/consolidation-detector.ts` | 1 | `Learning` | `import type { ... }` | El driven port `ConsolidationDetector.findConsolidations(learnings: readonly Learning[], ...)` recibe el aggregate `Learning` directo porque la heurística `score = use_count + confidence` (`docs/05-memoria-decay.md` §3) necesita los metadatos del aggregate. Una representación opaca obligaría a re-exportar use_count + confidence en una struct adicional sin ganancia semántica. El JSDoc del puerto (líneas 23-29) documenta exhaustivamente la elección. El `import type` es óptimo. |

**Conclusión:** los 3 cross-imports son del subset autorizado
(`memory/domain/` only) y están documentados en el JSDoc del archivo
correspondiente. Cumple §1.5 bajo el alcance ampliado por el
orquestador.

### 3.4 Estructura interna del módulo

Sigue el patrón canónico del codebase:
`aggregates/value-objects/services/events/repositories/errors`. Cero
desviaciones.

---

## 4. Cumplimiento SOLID (§1.4)

### 4.1 SRP — Single Responsibility

Cada uno de los 33 archivos tiene UNA razón de cambio:

- **`CuratorRun`** (aggregate, 17 métodos públicos): es la raíz del
  agregado para una pasada del curator. Las 6 mutaciones (`start`,
  `rehydrate`, `recordFinding`, `recordConsolidation`, `recordPrune`,
  `complete`) son las únicas operaciones de negocio; las 9 restantes
  son getters / predicates / drain de eventos, que son boilerplate
  obligatorio en un aggregate root. El conteo total (17) es
  comparable al precedente aprobado para `Workspace` (Tarea 2),
  `Decision`/`Learning`/`Entity`/`Task`/`Turn`/`Session`/`Relation`
  (Tarea 3) y `CommandHistory` (Tarea 7). **No es bloqueante.**

- **17 VOs**, cada uno con UNA responsabilidad cohesiva:
  - 6 enum-VOs derivados de SSOT `as const` (`MemoryEntryKind`,
    `CuratorRunTrigger`, `HealthFindingKind`, `HealthSeverity`,
    `PrunedReason`, `PathStalenessKindKind`).
  - 4 numeric-bounded VOs (`Confidence`/`Threshold`-like:
    `CosineScore`, `ConsolidationThreshold`, `PruneThreshold`,
    `DecayFactor`).
  - 1 catalog VO (`MaxEntriesPerKind`) — un mapping cap-por-kind con
    invariantes "todo kind tiene cap finito > 0".
  - 1 stats VO (`CuratorRunStats`) — 8 contadores no-negativos
    enteros, builder `with(...)` para composición funcional.
  - 1 reference VO (`AffectedEntryRef`) — par `(kind, id)` validado.
  - 1 finding VO (`HealthFinding`) — kind + severity + descripción
    + lista frozen de refs.
  - 1 pair VO (`ConsolidationPair`) — winner/loser/cosineScore con
    invariantes "no self-pair, no cross-kind".
  - 1 audit-snapshot VO (`PrunedEntry`) — payload de la tabla
    `pruned`.
  - 1 path-result VO (`PathStaleness`) — par `(path, kind)` con
    `kind ∈ {present, missing, unresolvable}`.
  - 1 brand-id VO (`CuratorRunId`) extends `Id<CuratorRunIdBrand>`.

- **3 driven ports** (`EntryCollector`, `ConsolidationDetector`,
  `PathChecker`) — cada uno con UN método específico.

- **1 servicio puro** (`DecayCalculator`) — un único método
  `newConfidence(...)` que codifica la fórmula geométrica de decay
  documentada en `docs/05-memoria-decay.md` §2. Sin estado, sin I/O.

- **5 eventos** (uno por hecho de negocio) en past-tense.

- **2 repositorios-puerto** (`CuratorRunRepository`,
  `PrunedEntryRepository`).

- **4 errores** (1 abstract base + 3 concretos), cada uno representa
  UNA falla específica con `code` estable kebab-case.

**Conteo bruto:** archivo más largo `curator-run.ts` con 360 líneas
(aggregate completo, justificado por defensive copies + JSDoc
exhaustivo). Ningún VO supera 220 líneas. La media es 71
líneas/archivo — código denso, JSDoc denso.

### 4.2 OCP — Open/Closed

- **Cero `if (kind === "X") { ... } else if (kind === "Y") { ... }`
  en clases centrales.** Los 6 SSOT con `as const`
  (`MEMORY_ENTRY_KINDS`, `CURATOR_RUN_TRIGGERS`,
  `HEALTH_FINDING_KINDS`, `HEALTH_SEVERITIES`, `PRUNED_REASONS`,
  `PATH_STALENESS_KINDS`) son fuente única de verdad runtime + tipo:
  agregar un valor es UNA línea en el array, y todo el código
  derivado (factories, type guards, predicates, persistence
  adapters) se actualiza en cascada por TypeScript.

- **`DecayFactor.forKind(kind, severity)`** es la única ramificación
  estructural sobre kind + severity, y está intencionalmente
  encapsulada en el VO `DecayFactor` (catalog factory). El branch
  único `if (kind.isLearning() && severity !== null)` no es
  OCP-violación: es la **selección del valor del catalog**
  (`LEARNING_DECAY_FACTORS_PER_DAY[severity.toString()]` vs
  `DEFAULT_DECAY_FACTORS_PER_DAY[kind.toString()]`), no dispatch de
  comportamiento. Agregar un nuevo `MemoryEntryKind` requiere UNA
  línea en `MEMORY_ENTRY_KINDS` + UNA línea en
  `DEFAULT_DECAY_FACTORS_PER_DAY` (ambos catalogs son cerrados con
  `Record<MemoryEntryKindKind, number>`, así que tsc rompe el
  catalog si no se sincroniza). **APROBADO**.

- **Cero switch statements en el scope** — confirmado por grep.

- **`isXxx()` predicates** en VOs (`MemoryEntryKind.isDecision()`,
  `HealthSeverity.isInfo()`, `PathStaleness.isPresent()`, etc.) son
  encapsulación interna del wrapped value, no dispatch externo. El
  consumer puede usar exhaustive `switch (kind.toString()) { ...
  default: const _: never = kind.toString(); ... }` desde el
  application layer y obtendrá narrowing exhaustivo.

### 4.3 LSP — Liskov Substitution

La única jerarquía del scope es la de errores:

```
DomainError                                         (shared)
└── CuratorDomainError (abstract)
    ├── CuratorRunAlreadyCompletedError
    ├── InvalidConsolidationPairError
    └── InvalidDecayFactorError
```

- Los 3 errores concretos heredan de `CuratorDomainError` que hereda
  de `DomainError`. Cada uno **estrecha** el contrato del padre con
  campos `readonly` propios (`runId: CuratorRunId`, `winner` y
  `loser: AffectedEntryRef`, `value: number`) sin debilitar
  pre/postcondiciones.
- `code: string` y `jsonRpcCode: number | null` son refinaciones
  válidas de los abstracts del padre — los 3 declaran
  `jsonRpcCode = null` con justificación explícita (todos son
  fallas internas que no traversan la frontera JSON-RPC).
- El catch genérico `instanceof CuratorDomainError` o `instanceof
  DomainError` capturará a los 3 sin sorpresas.
- `CuratorRunId extends Id<CuratorRunIdBrand>` (en
  `curator-run-id.ts`): hereda `equals`, `toString`, `toPrimitive`
  del padre sin override. La factory `from(raw: string):
  CuratorRunId` es estrechamiento del contrato genérico
  `Id.create<TBrand>(raw, fieldName)`. **APROBADO**.

Ninguna otra clase del scope tiene jerarquía de herencia.

### 4.4 ISP — Interface Segregation

- **`EntryCollector`** declara **1 método** (`listAllByKind`).
  Cohesivo: enumerar entradas por kind.
- **`ConsolidationDetector`** declara **1 método**
  (`findConsolidations`). Cohesivo: detectar candidatos a fusión.
- **`PathChecker`** declara **1 método** (`checkPaths`). Cohesivo:
  probar paths.
- **`CuratorRunRepository`** declara **4 métodos** (`findById`,
  `save`, `findRecentByWorkspace`, `findLastByWorkspace`).
  Cohesivos: persistencia + 2 queries de listado/inspección
  documentados en `docs/05-memoria-decay.md` §9.
- **`PrunedEntryRepository`** declara **3 métodos** (`save`,
  `findById`, `findByWorkspace`). Cohesivos: append-only + 2
  queries de auditoría.

Ninguna interface obliga a una implementación a `throw new Error("not
supported")`. Cada puerto tiene UN cliente claro: la
infraestructura del adaptador específico. **APROBADO**.

### 4.5 DIP — Dependency Inversion

- **Aggregate `CuratorRun`**: NO instancia adapters. Las únicas
  invocaciones `new` que ejecuta son a clases del mismo bounded
  context (`CuratorRun`, `CuratorRunStarted`,
  `HealthFindingDetected`, `LearningsConsolidated`, `EntryPruned`,
  `CuratorRunCompleted`) o a errores (`InvariantViolationError` de
  `shared/`, `CuratorRunAlreadyCompletedError` propio). Recibe
  `CuratorRunId`, `WorkspaceId`, `CuratorRunTrigger`, `Timestamp`
  por parámetro inyectado. **No lee reloj**: `Timestamp` siempre
  llega como parámetro `occurredAt`. **APROBADO**.

- **`DecayCalculator`**: 100% pure, **sin estado, sin I/O, sin
  reloj, sin RNG**. Recibe `current: Confidence`,
  `daysSinceLastUsed: number`, `kind: MemoryEntryKind`, `severity:
  LearningSeverity | null` por parámetro y devuelve `Confidence`.
  El único `Math.pow` es la fórmula matemática del lineamiento.
  Cero `Date.now()`, cero `new Date()`, cero `Math.random`, cero
  `crypto.*`, cero `process.*`, cero `console.*` (verificado por
  grep). **APROBADO**.

- **3 driven ports** son `interface` puras (no `abstract class`),
  declaran contrato. Las implementaciones vivirán en
  `infrastructure/` y serán inyectadas por composition root al use
  case del curator.

- **5 eventos** sólo definen forma de datos en past-tense, sin
  side-effects.

---

## 5. Cumplimiento de los puntos específicos del scope (Tarea 9)

### 5.1 SSOT con `as const` (punto 5)

Confirmados los 6 catalogs requeridos:

| SSOT | Archivo | Línea |
|---|---|---|
| `MEMORY_ENTRY_KINDS` | `memory-entry-kind.ts` | 20-26 |
| `CURATOR_RUN_TRIGGERS` | `curator-run-trigger.ts` | 16 |
| `HEALTH_FINDING_KINDS` | `health-finding-kind.ts` | 19-24 |
| `HEALTH_SEVERITIES` | `health-severity.ts` | 15 |
| `PRUNED_REASONS` | `pruned-reason.ts` | 24-29 |
| `PATH_STALENESS_KINDS` | `path-staleness.ts` | 19 |

Cada uno deriva la unión de tipo correspondiente
(`MemoryEntryKindKind`, `CuratorRunTriggerKind`, etc.) vía `(typeof
X)[number]`. Cada VO tiene type guard `isKind(candidate: string):
candidate is XKind` que itera el array defensivamente bajo
`noUncheckedIndexedAccess`. Agregar un nuevo valor es UNA línea +
TypeScript propaga la actualización a factories, predicates,
catalogs derivados (`SEVERITY_RANK` en `health-severity.ts`,
`DEFAULT_DECAY_FACTORS_PER_DAY` en `decay-factor.ts`). **APROBADO**.

### 5.2 ISP — 3 driven ports específicos (punto 7)

Verificado: `EntryCollector`, `ConsolidationDetector`, `PathChecker`
declaran cada uno **un único método** y cada uno con un cliente
inequívoco. Cero acoplamiento cruzado entre puertos. **APROBADO**.

### 5.3 DIP — Aggregate sin adapters; DecayCalculator puro (punto 8)

- `CuratorRun.start/recordFinding/recordConsolidation/recordPrune/complete`
  NO instancian adapters; reciben todo por parámetro. Verificado.
- `DecayCalculator` static class sin reloj, sin I/O, sin estado.
  Verificado por grep + por la lectura del archivo (33-106). El
  `private constructor` impide instanciación. **APROBADO**.

### 5.4 `Confidence` import desde shared y `LearningSeverity` import desde memory (punto 9)

- `decay-calculator.ts:2`: `import { Confidence } from
  "../../../../shared/domain/value-objects/confidence.ts";` — value
  import (necesario, se invoca `Confidence.of(decayed)` en línea
  104). Type-safe (Confidence es la SSOT en shared, conforme a §1.5
  Regla 3 — multiconsumer va a shared). **APROBADO**.
- `decay-calculator.ts:3`: `import type { LearningSeverity } from
  "../../../memory/domain/value-objects/learning-severity.ts";` —
  type import (óptimo, sólo se usa en signature). Type-safe. La
  excepción cross-módulo está autorizada por el orquestador. La
  alternativa "promover `LearningSeverity` a shared" se descartó
  porque rompe el Ubiquitous Language (la severidad ES propiedad
  del kind `learning`, que vive en `memory/`). **APROBADO**.
- `decay-factor.ts:1`: `import { LearningSeverity } from
  "../../../memory/domain/value-objects/learning-severity.ts";` —
  value import. **Sub-óptimo**: el archivo sólo usa `LearningSeverity`
  en posición de tipo (línea 54
  `Record<ReturnType<LearningSeverity["toString"]>, number>` y
  línea 114 `severity: LearningSeverity | null`). Podría ser
  `import type`, pero tsc estricto pasa porque el file no tiene
  `verbatimModuleSyntax: true` (no está en el listado §1.6) y el
  emitter de TS hace tree-shaking del import value-shape. Ver A1
  abajo. **APROBADO** con sugerencia preventiva.

### 5.5 `AffectedEntryRef` sin Id branded (punto 10)

`AffectedEntryRef` (`affected-entry-ref.ts`) almacena el id como
`string` validado vía la factory genérica `Id.create<"curator-affected-entry">(rawId, "affected_entry_id").toString()`
(líneas 43-49). El brand virtual `"curator-affected-entry"` se
descarta inmediatamente al llamar `.toString()`, así que el campo
final es un `string` sin brand.

**Análisis de type-safety:**

- **Pro**: la factory **valida** la forma UUID v7 y normaliza a
  lowercase; el id que sale es estructuralmente válido.
- **Con (no bloqueante)**: el campo `id: string` no porta el brand
  del aggregate origen (`DecisionId`/`LearningId`/`EntityId`/etc.).
  La razón es semántica: un `AffectedEntryRef` puede apuntar a
  *cualquiera* de los 5 kinds (`decision`/`learning`/`entity`/
  `task`/`turn`), y el brand efectivo lo discrimina el campo `kind:
  MemoryEntryKind` adyacente. La elección está documentada
  exhaustivamente en JSDoc del VO (líneas 4-22): "El id es la
  cadena UUID v7 canónica... la persistencia adapter puede
  round-trip sin mapping adicional".

  Este patrón **es type-safe contra inputs externos malformados**
  (la factory rechaza no-UUIDs) pero **NO contra mezcla de ids
  entre kinds** — el caller podría pasar
  `AffectedEntryRef.of(MemoryEntryKind.decision(),
  "<learning-uuid>")` y el VO lo aceptaría porque ambos son
  estructuralmente válidos.

  **Conclusión**: el trade-off es razonable para un VO genérico de
  audit/cross-kind. La validación estructural es la única que el
  dominio puede hacer sin una repository call (que rompería
  hexagonal). La validación de "este uuid efectivamente
  corresponde al kind X" pertenece al application layer cuando
  carga el aggregate. **APROBADO**.

### 5.6 `CuratorRunStats` con `with(...)` (punto 11)

Confirmado: `CuratorRunStats.with(overrides: Partial<CuratorRunStatsInput>):
CuratorRunStats` (líneas 115-133) **siempre retorna nueva instancia**
vía `CuratorRunStats.of(...)`, que re-valida cada contador en cascada.
Nunca muta `this.counters`. El campo es `private readonly counters:
CuratorRunStatsInput`. La interfaz interna `CuratorRunStatsInput`
declara TODOS los 8 campos como `readonly`. Inmutabilidad
correcta — equivalente al patrón Object.assign({}, this, overrides)
sin la fragilidad de `Object.assign`. **APROBADO**.

---

## 6. Hallazgos

### CRÍTICOS (bloquean aprobación)

**Ninguno.** El código cumple §1.4 (SOLID), §1.5 (modularidad bajo
alcance ampliado por orquestador) y §1.6 (type-safety total) **sin
violaciones bloqueantes**.

### ADVERTENCIAS (no bloqueantes — preventivas)

#### A1. `LearningSeverity` y `MemoryEntryKind` importados como value cuando sólo se usan en posición de tipo

- **Archivo:** `code/src/modules/curator/domain/value-objects/decay-factor.ts:1` y `:3`
- **Detalle:**
  - Línea 1: `import { LearningSeverity } from "../../../memory/domain/value-objects/learning-severity.ts";` — `LearningSeverity` se usa SÓLO en posición de tipo (líneas 54 y 114). Debería ser `import type { LearningSeverity }`.
  - Línea 3: `import { MemoryEntryKind } from "./memory-entry-kind.ts";` — `MemoryEntryKind` se usa SÓLO en posición de tipo (líneas 33 y 113). Debería ser `import type { MemoryEntryKind }`.
- **Impacto:** ninguno en runtime ni en tsc estricto (pasa clean). Sin embargo:
  - Si en el futuro se activa `verbatimModuleSyntax: true` (flag adicional que algunos proyectos adoptan), estos imports romperían el build.
  - El precedente del codebase (Tareas 1-7) usa consistentemente `import type` para imports type-only.
  - El propio archivo `decay-calculator.ts:3` ya usa `import type { LearningSeverity }` correctamente — la inconsistencia es intra-módulo.
- **Fix sugerido (preventivo):** convertir las dos líneas de `decay-factor.ts` a `import type { ... }`. Cambio cosmético, cero impacto en runtime.

#### A2. `AffectedEntryRef.id: string` no porta brand cross-kind

- **Archivo:** `code/src/modules/curator/domain/value-objects/affected-entry-ref.ts:34`
- **Detalle:** ver §5.5 arriba. El campo `id: string` es structurally validated (UUID v7 canonical) pero no carries el brand del `kind` adyacente (`DecisionIdBrand`/`LearningIdBrand`/etc.). Un caller podría pasar
  `AffectedEntryRef.of(MemoryEntryKind.decision(), "<learning-uuid>")`
  y el VO lo aceptaría.
- **Justificación documentada:** el JSDoc (líneas 4-22) explica que el VO es genérico cross-kind por diseño y que el round-trip a `pruned.original_id` requiere `string` plano. La validación "kind ↔ id corresponden" pertenece al application layer cuando carga el aggregate.
- **Fix sugerido (futuro, opcional):** si el equipo quiere endurecer la garantía sin romper el round-trip, una opción es introducir un *discriminated union* `AffectedEntryRef = DecisionRef | LearningRef | ...` con un `id` branded por variante. El precio es la pérdida de la abstracción cross-kind (todos los consumers del VO tendrían que narrow). Para el MVP es prematuro.

### POSITIVOS

#### Aspectos específicos del scope (Tarea 9)

- **`CuratorRunStats.with(...)` inmutable**: verificado, retorna SIEMPRE nueva instancia vía `CuratorRunStats.of(...)` que re-valida en cascada (§5.6).
- **6 SSOT `as const`**: los 6 catalogs requeridos por el orquestador están presentes y derivan tipos vía `(typeof X)[number]` (§5.1).
- **3 driven ports cohesivos**: `EntryCollector`, `ConsolidationDetector`, `PathChecker` con un único método cada uno; cero acoplamiento (§5.2).
- **`DecayCalculator` puro**: cero side effects, cero I/O, cero reloj, cero RNG. Static class con `private constructor` (§5.3).
- **`CuratorRun` aggregate sin adapters**: sólo recibe parámetros inyectados; el reloj llega como `occurredAt: Timestamp` desde la composition root (§5.3).
- **5 eventos en past-tense kebab-case** con prefijo `curator.*`: `curator.run-started`, `curator.run-completed`, `curator.entry-pruned`, `curator.health-finding-detected`, `curator.learnings-consolidated`. Convención del codebase respetada (Tarea 2 estableció el patrón `<module>.<event-name>`).
- **`PrunedEntry` modelado como VO** (no aggregate), porque su lifecycle es "create on prune, read on audit" — append-only sin mutación. El JSDoc lo justifica explícitamente (líneas 26-30).
- **`CuratorRun.complete(...)` enforces invariante temporal** `occurredAt >= startedAt` (línea 273) y rechaza re-completion (línea 270).
- **`CuratorRun.rehydrate(...)` rejects corrupt rows** con `endedAt < startedAt` (línea 159).

---

## 7. Veredicto justificado

**APROBADO.**

Los **33 archivos** del scope `curator/domain` cumplen los lineamientos
§1.4 (SOLID), §1.5 (modularidad — bajo alcance ampliado autorizado por
el orquestador en `.claude/workflow-state.json` para permitir
imports desde `memory/domain/`) y §1.6 (type-safety total) **sin
excepciones bloqueantes**. La compilación con `tsc --strict` y los 16
flags exigidos pasa con cero errores y cero warnings sobre el corpus
completo (130 archivos: shared + memory + curator).

**Cumplimiento type-safety total (§1.6):**
- Cero `any`, cero `as any`, cero `// @ts-ignore`, cero `// @ts-nocheck`,
  cero `// @ts-expect-error`, cero `eslint-disable`.
- Cero lectura de wall-clock (`Date.now`, `new Date()`), cero RNG
  (`Math.random`, `crypto.*`), cero side effects (`console.*`,
  `process.*`).
- `unknown` minimizado a la única categoría permitida `cause?:
  unknown` (4 ocurrencias en errors/, patrón canónico ES2022
  `Error.cause`).
- 7 casts (` as `) totales — los 6 SSOT `as const` (que son la
  fuente única de verdad runtime + tipo) + 1 brand-application
  canónica en `CuratorRunId.from`.
- Discriminated unions exhaustivas derivadas de SSOT `as const` para
  los 6 enums (`MemoryEntryKindKind`, `CuratorRunTriggerKind`,
  `HealthFindingKindKind`, `HealthSeverityKind`, `PrunedReasonKind`,
  `PathStalenessKindKind`).
- Tipos de retorno explícitos en TODA función/método.
- `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`,
  `noPropertyAccessFromIndexSignature`, `noImplicitOverride`,
  `noFallthroughCasesInSwitch` honrados.

**Cumplimiento SOLID (§1.4):**
- **SRP**: cada uno de los 33 archivos tiene UNA razón de cambio. El
  aggregate `CuratorRun` con 17 métodos públicos sigue el patrón
  estructural inevitable de aggregate root (6 mutaciones reales + 9
  getters/predicates + 2 factories), comparable al precedente
  aprobado para `Workspace`/`Decision`/`Learning`/`CommandHistory`.
- **OCP**: agregar un nuevo `MemoryEntryKind`/`CuratorRunTrigger`/
  `HealthFindingKind`/`HealthSeverity`/`PrunedReason`/`PathStalenessKind`
  es UNA línea en el SSOT correspondiente — todos los catalogs
  derivados (`DEFAULT_DECAY_FACTORS_PER_DAY`,
  `LEARNING_DECAY_FACTORS_PER_DAY`, `SEVERITY_RANK`) usan
  `Record<KKind, V>` cerrado, por lo que TypeScript fuerza la
  sincronización en compile-time. Cero switches gigantes. Cero `if
  (kind === ...)` dispatch en clases centrales.
- **LSP**: los 3 errores concretos heredan de
  `CuratorDomainError → DomainError` estrechando con campos
  `readonly` propios y refinando `jsonRpcCode = null`, sin debilitar
  pre/postcondiciones. `CuratorRunId extends Id<CuratorRunIdBrand>`
  hereda métodos sin override y estrecha la factory.
- **ISP**: los 3 driven ports declaran 1 método cada uno; los 2
  repositorios declaran 3-4 métodos cohesivos. Ninguna interface
  obliga a `throw new Error("not supported")`.
- **DIP**: el aggregate no instancia adapters, recibe todo por
  parámetro inyectado, no lee reloj. `DecayCalculator` es 100% pure.
  Los 3 driven ports y los 2 repositorios son interface puras.

**Cumplimiento modularidad estricta (§1.5) bajo alcance ampliado:**
- Imports SÓLO de `shared/domain/` (~25) o de `memory/domain/` (3,
  documentados exhaustivamente: `LearningSeverity` x2 + `Learning`
  x1) o intra-módulo (~50).
- Cero imports desde `workspace/`, `retrieval/`, `encryption/`,
  `secrets/`, `mcp-server/`, `cli/`, `connectors/`.
- Cero imports desde `memory/application/` o
  `memory/infrastructure/` (sólo `memory/domain/` autorizado).
- La excepción cross-módulo `curator → memory/domain` está codificada
  por el orquestador en `tasks.curator-domain.depends_on:
  ["shared-domain", "memory-domain"]` y es coherente con el mismo
  precedente para `retrieval/domain`.

**Las 2 advertencias listadas son sugerencias preventivas:**

- **A1** observa que `decay-factor.ts:1,3` importa `LearningSeverity`
  y `MemoryEntryKind` como value cuando sólo se usan en posición de
  tipo. Sin impacto en runtime ni en tsc estricto. Convertir a
  `import type` alinea con el resto del codebase y blinda contra
  futuras adopciones de `verbatimModuleSyntax`.
- **A2** observa que `AffectedEntryRef.id: string` no porta brand
  cross-kind. Es trade-off documentado en JSDoc (genericidad
  cross-kind para round-trip a `pruned.original_id`). Si el equipo
  quiere endurecer, la opción discriminated union está disponible
  pero es prematura para el MVP.

Ninguna advertencia afecta corrección actual ni viola ningún
lineamiento.

El módulo `curator/domain` está listo para que la fase de application
monte los use cases (`RunCuratorPassUseCase`,
`ConsolidateLearningsUseCase`, `PruneEntryUseCase`, etc.) y para que
la fase de infraestructura implemente los adapters
(`SqliteCuratorRunRepository`, `SqlitePrunedEntryRepository`,
`MemoryEntryCollector`, `EmbeddingConsolidationDetector`,
`FilesystemPathChecker`).

---

## 8. Próximo paso recomendado

1. **Liberar al ddd-validator** (en paralelo, revisa §1.2/§1.3) para
   cerrar el ciclo de validación de Tarea 9.
2. La **Fase de application** debe diseñar los use cases que orquestan
   `CuratorRun`:
   - `RunCuratorPassUseCase` compone `EntryCollector.listAllByKind` →
     `DecayCalculator.newConfidence` → `LearningRepository.save` (vía
     event handler) → `ConsolidationDetector.findConsolidations` →
     `CuratorRun.recordConsolidation` → `PathChecker.checkPaths` →
     `CuratorRun.recordFinding` → `CuratorRun.complete` →
     `CuratorRunRepository.save`.
   - `ConsolidateLearningsUseCase` reacciona al evento
     `curator.learnings-consolidated` y ejecuta
     `Learning.consolidateInto(winnerId)` sobre el loser.
   - `PruneEntryUseCase` reacciona al evento `curator.entry-pruned` y
     mueve el row a `pruned` vía `PrunedEntryRepository.save`.
3. La **Fase de infrastructure** debe implementar los 5 adapters:
   `SqliteCuratorRunRepository`, `SqlitePrunedEntryRepository`,
   `MemoryEntryCollector` (compone los 5 repositorios kind-específicos
   de `memory/`), `FastembedConsolidationDetector` (usa
   `Embedder` + cosine), `FilesystemPathChecker` (usa `fs.stat`).
4. La **Fase de QA** debe agregar tests unitarios sobre invariantes
   específicas:
   - **`DecayCalculator.newConfidence`**: short-circuit cuando
     `factor.isUnity()` (verificar `task` y `learning(critical)`
     retornan input unchanged); short-circuit cuando
     `daysSinceLastUsed === 0`; rechaza
     `daysSinceLastUsed: -1`/`NaN`/`Infinity`; valida que el
     resultado siempre cae en [0, 1] (test con 1000 random inputs).
   - **`DecayFactor.forKind`**: para cada kind ∈ {decision, learning,
     entity, task, turn} retorna el factor correcto del catalog;
     para kind=learning + severity ∈ {tip, warning, critical}
     retorna el override severity-específico; rechaza factor 0,
     factor > 1, factor NaN.
   - **`CuratorRun.complete`**: rechaza re-completion
     (`CuratorRunAlreadyCompletedError`); rechaza `occurredAt <
     startedAt` (`InvariantViolationError`); emite
     `CuratorRunCompleted` exactamente una vez.
   - **`CuratorRun.recordFinding/recordConsolidation/recordPrune`**:
     rechazan llamada después de `complete()`
     (`CuratorRunAlreadyCompletedError`); cada uno emite el evento
     correspondiente.
   - **`CuratorRunStats.with`**: idempotente, valida cada contador
     re-emitido, retorna nueva instancia.
   - **`ConsolidationPair.of`**: rechaza `winner === loser`
     (`InvalidConsolidationPairError`); rechaza
     `winner.kind !== loser.kind`.
   - **`MaxEntriesPerKind.of`**: rechaza cap=0, cap=-1, cap=1.5,
     cap=NaN para cada kind; default fills missing kinds con
     `DEFAULT_MAX_ENTRIES`.
   - **`PathStaleness`**: factories `present`/`missing`/`unresolvable`
     normalizan path (rechazan empty/non-string);
     `requiresAttention()` true para missing/unresolvable, false
     para present.
   - **`AffectedEntryRef.of`**: rechaza UUID malformado; normaliza
     case; el `id` resultante es lowercase.
   - **`HealthFinding.create`**: rechaza description vacía,
     description con sólo whitespace, description >
     `MAX_DESCRIPTION_LENGTH`; freeze `affectedEntries`.
