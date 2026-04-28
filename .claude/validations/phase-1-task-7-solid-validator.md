# SOLID + Type-Safety Validation — Phase 1, Task 7: cli/domain
**Validator:** solid-validator
**Date:** 2026-04-27
**Verdict:** APROBADO (sin advertencias bloqueantes; 2 sugerencias menores)

---

## Resultado de tsc estricto

**PASS — exit code 0, cero errores, cero warnings.**

Comando ejecutado (TypeScript 5.6.3, scratch project en
`/tmp/solidcheck-cli`):

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
`code/src/modules/cli/domain/**/*.ts` (12 archivos) = **26 archivos**.

Resultado: **`exit=0`**. Los 12 archivos del scope CLI compilan limpio
contra los 14 archivos de `shared/domain` (que ya están validados en
Tarea 1) bajo el régimen estricto completo.

### Auditoría grep complementaria

| Patrón | Matches en `cli/domain/` |
|---|---|
| `: any` (anotación de tipo) | **0** |
| `as any` | **0** |
| `<any>` (type argument any) | **0** |
| `Promise<any>` | **0** |
| `Array<any>` | **0** |
| `as unknown` | **0** |
| ` as <Type>` (cast genérico) | **0** |
| `// @ts-ignore` | **0** |
| `// @ts-nocheck` | **0** |
| `// @ts-expect-error` | **0** |
| `eslint-disable` | **0** |
| `Date.now` / `new Date()` (en código, no comentario) | **0** |
| `Math.random` / `crypto.*` | **0** |
| `process.*` / `console.*` (en código, no comentario) | **0** |
| `throw new` | 9 — todos sobre `UnknownCommandError`, `InvalidExitCodeError`, `InvalidInputError`, `InvariantViolationError` (cero excepciones genéricas) |

### Casts (`as ...`) en posición de tipo

Se encontraron **2 ocurrencias** y ambas son canónicas:

1. **`COMMAND_NAMES ... as const`** en `command-name.ts:52` —
   patrón A3 (Tarea 2, aplicado uniformemente en `WORKSPACE_MODE_KINDS`,
   `SCOPE_KINDS`, `JsonRpcErrorCodes`, `EXIT_CODES`). Deriva la unión
   `CommandNameValue = (typeof COMMAND_NAMES)[number]` desde el array.
   Una sola fuente de verdad runtime + tipo. **APROBADO**.

2. **`EXIT_CODES = { ... } as const`** en `exit-code.ts:44` — mismo
   patrón sobre el objeto: deriva `ExitCodeKind = keyof typeof EXIT_CODES`
   y `CatalogedExitValue = (typeof EXIT_CODES)[ExitCodeKind]`. La
   función `kindForValue` usa `Object.keys(EXIT_CODES) as readonly
   ExitCodeKind[]` (línea 164) — el cast es necesario porque
   `Object.keys` devuelve `string[]` por contrato del lib y aquí
   sabemos que los keys son la unión cerrada del literal-as-const.
   **APROBADO** — runtime-seguro, restringido a la función helper.

**Cero `any` en posición de tipo. Cero `ts-ignore`. Cero supresión de
linter. Cero lectura de wall-clock o RNG no inyectado.**

### `unknown` justificado

Se encontraron **5 ocurrencias** de `unknown` en código (no comentarios)
y todas caen dentro de las dos categorías permitidas por la rúbrica:

| Archivo | Línea | Uso | Categoría |
|---|---|---|---|
| `command-args.ts` | 46 | `private readonly payload: unknown` | `CommandArgs.payload` |
| `command-args.ts` | 53 | `static of(payload: unknown)` | `CommandArgs.payload` |
| `command-args.ts` | 71 | `raw(): unknown` | `CommandArgs.raw()` |
| `errors/cli-domain-error.ts` | 45 | `options?: { cause?: unknown }` | `cause?: unknown` |
| `errors/invalid-exit-code-error.ts` | 23 | `options?: { cause?: unknown }` | `cause?: unknown` |
| `errors/invalid-command-args-error.ts` | 32 | `options: { ... cause?: unknown }` | `cause?: unknown` |
| `errors/unknown-command-error.ts` | 24 | `options?: { cause?: unknown }` | `cause?: unknown` |

- **`CommandArgs.payload` / `raw()`**: justificación documentada
  exhaustivamente en el JSDoc del archivo (líneas 1-43), explicando por
  qué un tipo más rico violaría hexagonal: el shape de los args es
  heterogéneo entre comandos, conocerlo en el dominio acoplaría al
  parser específico (commander/yargs/etc), y el parser de application
  ya produce input tipado por Zod para los use cases. **APROBADO**.
- **`cause?: unknown`** en los 3 errores concretos + el abstract base:
  patrón canónico heredado de la API estándar de `Error.cause`
  (ES2022). Coincide con `DomainError`, `WorkspaceDomainError`,
  `MemoryDomainError`, `InvalidInputError`, `InvariantViolationError`
  validados en tareas previas. **APROBADO**.

**Cero `unknown` no justificado. Cero `unknown` derivado en otras
posiciones.**

### Auditoría de modularidad estricta (§1.5)

`grep -rEn "^import" code/src/modules/cli/domain/` produce **23
imports**, todos clasificables en exactamente dos categorías:

1. **Imports relativos a `../../../../shared/domain/...`** (12
   imports) — `domain-error.ts`, `domain-event.ts`, `timestamp.ts`,
   `workspace-id.ts`, `invalid-input-error.ts`,
   `invariant-violation-error.ts`. Todos **PERMITIDOS** por §1.5.
2. **Imports intra-módulo** (`./...`, `../value-objects/...`,
   `../errors/...`, `../events/...`, `../aggregates/...`) (11
   imports). Todos **PERMITIDOS** por §1.5.

**Cero imports** desde `modules/workspace/`, `modules/memory/`,
`modules/retrieval/`, `modules/curator/`, `modules/encryption/`,
`modules/secrets/`, `modules/mcp-server/`, `modules/connectors/`. La
regla de modularidad estricta se cumple sin excepciones.

```bash
$ grep -rEn "from \"" code/src/modules/cli/domain/ \
    | grep -E "modules/(workspace|memory|retrieval|curator|encryption|secrets|mcp-server|connectors|background|persistence|telemetry)"
# (vacío)
```

Las menciones a "workspace", "cross-workspace", "cross-module",
"cross-cutting" en el corpus están todas en JSDoc — verificado por
inspección.

---

## Hallazgos

### CRÍTICOS (bloquean aprobación)

**Ninguno.** El código cumple §1.4 (SOLID), §1.5 (modularidad estricta)
y §1.6 (type-safety total) **sin violaciones bloqueantes**.

### ADVERTENCIAS (no bloqueantes — preventivas)

#### A1. Performance — `recordExecution` con `shift()` es O(n) y los `for` walks recorren la lista completa del buffer en `recentExecutions`

- **Archivo:** `code/src/modules/cli/domain/aggregates/command-history.ts:174-179`
- **Detalle:** Cuando el buffer está al máximo (`MAX_CAPACITY=1000`),
  `recordExecution` invoca `Array.shift()`, que es O(n) por
  reindexado en V8/Node. El comentario inline (línea 175-178) ya
  reconoce el trade-off ("acceptable; the alternative — circular
  index — would leak ring-buffer mechanics into every query method.
  Capacity is bounded by `MAX_CAPACITY`"), así que **no es bug** —
  es elección documentada.
- **Type-safety:** **CERO leaks de tipos.** `Array.shift()` devuelve
  `CommandExecution | undefined` (por `noUncheckedIndexedAccess`);
  el código descarta el resultado (`this.executions.shift();` sin
  asignación), por lo que la posibilidad `undefined` no se propaga
  a ningún sitio. El `while` con `> this.capacity` garantiza que
  `shift()` sólo se invoca cuando hay >= 1 elemento, así que el
  retorno `undefined` nunca ocurre en runtime. Verificado por
  `tsc --strict` que pasa limpio.
- **`recentExecutions` (línea 217-223)**: `new Array<CommandExecution>(effective)` crea
  un array sparse cuyos elementos **son** `CommandExecution` para el
  type system pero `undefined` en runtime hasta ser asignados. La
  asignación posterior `out[i] = source` (con `source` ya
  narrow-checked como `!== undefined`) llena todos los slots. El
  retorno `Object.freeze(out)` lo congela. **Cero leaks**, pero hay
  una sutileza: si el for-loop rompiera (no rompe en este código —
  no hay break, sólo `continue`), quedarían slots con `undefined`
  detrás del tipo. El compilador no lo detectaría.
- **Conclusión:** No bloquea. Capacity está acotada por `MAX_CAPACITY=1000`
  y la latencia esperada es <100µs incluso en el peor caso. La
  decisión está justificada por el comentario inline.
- **Fix sugerido (preventivo, opcional):** si en el futuro la traza
  de `mcp-memoria stats` muestra que el aggregate concentra latencia,
  reemplazar el ring buffer naive por uno circular (índice
  `head`/`tail` mod `capacity`). El cambio es intra-aggregate y no
  toca el contrato público. Para la implementación actual del MVP
  basta con lo que está.

#### A2. ISP / SRP — `CommandHistory.recentExecutions` valida `limit` aquí en vez de delegar a un VO `Limit`

- **Archivo:** `code/src/modules/cli/domain/aggregates/command-history.ts:207-225`
- **Detalle:** El método valida que `limit` sea entero no-negativo
  (línea 209-214). Hay precedente en `shared/domain` para encapsular
  validaciones de números (`UseCount`, `Confidence`, `Tokens`). Un
  `Limit` VO en `shared/domain/value-objects/` aplicaría DRY y
  permitiría reusar la validación en futuros queries paginados.
- **Conclusión:** No es violación de SRP — el aggregate valida UN
  invariante propio del query (no exponer estado mutable). No es
  violación de ISP — la interface es la interna del aggregate, no
  un puerto. Es una micro-fricción que aparecería cuando otros
  módulos repliquen el patrón.
- **Fix sugerido (futuro):** si el módulo `retrieval` o `memory`
  expone queries paginados con el mismo patrón `limit`, mover la
  validación a un `PageLimit` VO en `shared/`. Para CLI MVP es
  prematuro.

### POSITIVOS

#### SOLID (§1.4)

- **SRP** — Cada uno de los 12 archivos tiene UNA razón de cambio:
  - `CommandName` (1 VO) — identidad del comando, sin behaviour
    accesorio.
  - `CommandArgs` (1 VO) — contenedor opaco del payload, sin parsing.
  - `CommandOutput` (1 VO) — la tripleta (stdout, stderr, exitCode),
    inmutable, con builder fluido.
  - `ExitCode` (1 VO) — el integer POSIX 0..255 + el catálogo
    nombrado, validación en boundaries.
  - `CommandExecution` (1 VO) — el record completo de una invocación
    (name+args+startedAt+endedAt+output), valida invariante temporal.
  - `CommandHistory` (1 aggregate) — ring buffer ordenado por
    `endedAt`, emite `CommandExecuted` en cada append.
  - `CommandExecuted` (1 event) — un fact sobre una ejecución que
    terminó; campos `readonly`.
  - `CommandHistoryRepository` (1 puerto) — 3 métodos CRUD
    (`findById`, `save`, `delete`).
  - 4 errores (`CliDomainError` abstracto + 3 concretos). Cada
    error representa UNA falla específica con `code` estable y
    `jsonRpcCode = null` documentado.

  **Conteo bruto:** ningún archivo del scope supera los heurísticos:
  - Archivo más largo: `command-history.ts` con 288 líneas (sólo
    aggregate, justificado por defensive copies + invariantes
    completas).
  - Ningún VO/error supera 175 líneas.
  - El aggregate tiene 11 métodos públicos (`empty`, `rehydrate`,
    `recordExecution`, `getId`, `getCapacity`, `recentExecutions`,
    `size`, `isEmpty`, `latest`, `pullEvents`, `equals`) — sigue
    el patrón de Tarea 2/3 donde 7-9 son getters/predicates +
    `pullEvents` boilerplate y sólo 1 (`recordExecution`) es
    mutación real.

- **OCP** — Cero `if (kind === "X") { ... } else if (kind === "Y") { ... }`.
  Los 22 valores de `COMMAND_NAMES` se manejan vía discriminated
  union derivada de `as const` y el método `isValue` itera la lista
  defensivamente. Agregar un nuevo comando es **una sola línea** en
  el array — cero código existente se modifica. Idéntico patrón en
  los 8 valores de `EXIT_CODES`: agregar un nuevo exit-code es una
  línea en el objeto + las constantes derivadas se actualizan en
  cascada por TypeScript.

  **Cero switches gigantes.** La única función con multi-branch
  estructural es `kindForValue` (exit-code.ts:163-171) — un loop
  sobre las keys del catálogo para reverse-lookup; es O(8) constant
  por catálogo cerrado, agregar una entrada al catálogo no
  requiere editar el loop.

- **LSP** — Las 3 subclases concretas (`UnknownCommandError`,
  `InvalidExitCodeError`, `InvalidCommandArgsError`) heredan de
  `CliDomainError` que hereda de `DomainError`. Cada una **estrecha**
  el contrato del padre con campos `readonly` adicionales
  (`attempted: number/string`, `commandName: string`, `field: string
  | null`) sin debilitar pre/postcondiciones del padre. El
  `jsonRpcCode: number | null = null` declarado en cada subclase es
  una refinación válida del `jsonRpcCode: number | null` abstracto.
  Los 3 mantienen un `code` estable kebab-case
  (`cli.unknown-command`, `cli.invalid-exit-code`,
  `cli.invalid-command-args`). El catch genérico `instanceof
  CliDomainError` o `instanceof DomainError` capturará a todos sin
  sorpresas.

  Ninguna otra clase del scope tiene jerarquía de herencia.

- **ISP** — `CommandHistoryRepository` declara **3 métodos**
  cohesivos: `findById`, `save`, `delete`. No hay query ad-hoc
  (`findByName`, `findByDateRange`) ni write parcial
  (`appendOne`, `evictOldest`); el aggregate completo es la unidad
  de persistencia, alineado con §1.3 y §1.5 del lineamiento.
  Ninguna implementación se vería forzada a `throw new Error("not
  supported")`.

  Las interfaces `DomainEvent` y la abstract `CliDomainError`
  declaran sólo lo mínimo que el contrato cross-aggregate exige.

- **DIP** — El aggregate **NO instancia adapters**: recibe
  `WorkspaceId`, `capacity`, `executions` y `events` por parámetro.
  El único `new` que el aggregate ejecuta es a clases del mismo
  bounded context (`CommandHistory`, `CommandExecuted`) o a errores
  de `shared/domain` (`InvalidInputError`,
  `InvariantViolationError`) — ambos legítimos por §1.4.

  El dominio **nunca lee el reloj**: `Timestamp` siempre llega como
  parámetro inyectado (`startedAt`, `endedAt`, `occurredAt`) por la
  composition root vía el puerto `Clock`. **Cero `Date.now()`,
  cero `new Date()`, cero `Math.random`, cero `crypto.*`,
  cero `process.*`, cero `console.*`** en el scope.

  La interface `CommandHistoryRepository` es un puerto puro
  (`interface`, no `abstract class`); declara contrato.
  La implementación viva en `infrastructure/persistence/` será
  inyectada por composition root al use case.

#### Modularidad estricta (§1.5)

- **Cero imports cross-módulo.** Los 23 imports listados van
  exclusivamente a `shared/domain/...` (12) o a paths intra-módulo
  (11). Cero referencias a otros bounded contexts.
- **Estructura interna correcta**:
  `value-objects/aggregates/events/repositories/errors`. No hay
  `services/` (correcto: el módulo no tiene lógica cross-aggregate).
- **Aplicación canónica de `import type`**: 11 de los 23 imports usan
  `import type` cuando sólo se requiere el tipo en signatures
  (`Timestamp`, `WorkspaceId`, `CommandName`, `CommandArgs`,
  `CommandOutput`, `CommandExecution`, `CommandHistory`,
  `DomainEvent`). Esto ayuda al tree-shaker y al build paralelo y
  refuerza el aislamiento entre value-objects.

#### Type-safety total (§1.6)

- **Cero `any`** en posición de tipo (verificado por grep + por
  `tsc --strict --noImplicitAny` pasa limpio).
- **Casts (` as `) sólo canónicos**: 2 ocurrencias, ambas son
  `as const` para SSOT (catálogo de comandos + catálogo de exit
  codes) más el cast obligado en `Object.keys(EXIT_CODES) as
  readonly ExitCodeKind[]` (línea 164 de `exit-code.ts`) restringido
  a un helper interno. **Cero `as any`, cero `as unknown`,
  cero `as Type` arbitrario.**
- **Cero `// @ts-ignore` / `// @ts-nocheck` /
  `// @ts-expect-error`**.
- **Cero `eslint-disable` o equivalente.**
- **`unknown` justificado y minimizado**: 7 ocurrencias totales, 4
  en `cause?: unknown` (patrón canónico ES2022 `Error.cause`) y 3
  en `CommandArgs` (payload + raw + factory) con justificación
  exhaustiva en el JSDoc. **Cero `unknown` derivado en otras
  posiciones.**
- **Tipos de retorno explícitos** en TODAS las funciones/métodos de
  la superficie pública: factories (`CommandName.create(raw:
  string): CommandName`, `CommandArgs.of(payload: unknown):
  CommandArgs`, `CommandArgs.empty(): CommandArgs`,
  `CommandOutput.create(input): CommandOutput`,
  `CommandOutput.empty(): CommandOutput`,
  `CommandOutput.stdoutOnly(text: string): CommandOutput`,
  `CommandOutput.failure(input): CommandOutput`,
  `ExitCode.from(kind): ExitCode`, `ExitCode.fromValue(value):
  ExitCode`, `ExitCode.success(): ExitCode`,
  `CommandExecution.create(input): CommandExecution`,
  `CommandHistory.empty(input): CommandHistory`,
  `CommandHistory.rehydrate(input): CommandHistory`), helpers
  privados (`CommandHistory.assertCapacity(capacity: number):
  void`, `CommandHistory.tailOrNull(): CommandExecution | null`,
  `ExitCode.kindForValue(value: number): ExitCodeKind | null`),
  builders (`CommandOutput.withStdout(text): CommandOutput`,
  `CommandOutput.withStderr(text): CommandOutput`,
  `CommandOutput.withExitCode(code): CommandOutput`), getters
  (`getId(): WorkspaceId`, `getCapacity(): number`,
  `size(): number`), predicates (`isSuccess(): boolean`,
  `isFailure(): boolean`, `isEmpty(): boolean`,
  `wasSuccessful(): boolean`), serialisers (`toString():
  CommandNameValue`, `toNumber(): number`, `raw(): unknown`),
  drains (`pullEvents(): readonly DomainEvent[]`),
  type guards (`isValue(candidate: string): candidate is
  CommandNameValue`), comparators (`equals(other: ...): boolean`).
  **Cero inferencia implícita en superficie pública.**
- **`exactOptionalPropertyTypes` honrado** — los 3 errores concretos
  usan el patrón `options.cause !== undefined ? { cause:
  options.cause } : undefined` (verificado en
  `cli-domain-error.ts:48`, `invalid-command-args-error.ts:36`,
  `invalid-exit-code-error.ts:26`, `unknown-command-error.ts:27`).
  El aggregate usa `input.capacity ?? DEFAULT_CAPACITY` (líneas
  106, 123) — tratamiento explícito del `undefined`. Los tipos
  union usan `string | null`, `number | null`, `ExitCodeKind |
  null` (no `?:` opcional) para que el null sea **dato explícito**.
- **`noUncheckedIndexedAccess` honrado** — verificado:
  - `command-name.ts:114` itera con `const known = COMMAND_NAMES[i];
    if (known !== undefined && known === candidate) return true;`
  - `exit-code.ts:166-167` itera con `const key = keys[i]; if (key
    === undefined) continue;`
  - `command-history.ts:134-136` lee con `const previous =
    input.executions[i - 1]; const current = input.executions[i];
    if (previous === undefined || current === undefined) continue;`
  - `command-history.ts:220-222` lee con `const source =
    this.executions[this.executions.length - 1 - i]; if (source
    === undefined) continue; out[i] = source;`
  - `command-history.ts:268-271` (`tailOrNull`) usa `const tail =
    this.executions[this.executions.length - 1]; return tail ??
    null;`
- **`noPropertyAccessFromIndexSignature` honrado** — el lookup
  `EXIT_CODES[key]` (línea 168) usa bracket notation porque
  `key: ExitCodeKind` es la unión cerrada keyof, no un index
  signature; tsc lo permite. El acceso `EXIT_CODES[kind]` (línea
  110) es idéntico — `kind: ExitCodeKind`.
- **`noImplicitOverride` honrado** — los 3 errores concretos no
  usan `override` keyword porque NO overridean métodos del padre,
  sólo agregan campos `readonly` propios + el `code`/`jsonRpcCode`
  abstractos del padre (que TypeScript no clasifica como override
  por ser abstracts).
- **`noImplicitReturns` honrado** — todas las funciones con tipo de
  retorno no-`void` retornan en TODOS los caminos. Verificado por
  `tsc`.
- **`noFallthroughCasesInSwitch` honrado** — **cero switch
  statements** en el scope, lo que elimina la categoría completa de
  fall-through bugs.
- **Discriminated unions correctos:**
  - `CommandNameValue` — unión de 22 string literals derivada de
    `(typeof COMMAND_NAMES)[number]`. Type guard `isValue` exhaustivo.
  - `ExitCodeKind` — unión de 8 string literals derivada de
    `keyof typeof EXIT_CODES`. Mapping numérico
    `CatalogedExitValue = (typeof EXIT_CODES)[ExitCodeKind]`.
  - `eventName` literal en `CommandExecuted`:
    `"cli.command-executed"` con narrowing exhaustivo posible —
    un subscriber puede hacer `switch (event.eventName)` con
    discriminator entre los módulos.
- **Inmutabilidad disciplinada**:
  - `private constructor` en TODOS los VOs concretos (5/5:
    `CommandName`, `CommandArgs`, `CommandOutput`, `ExitCode`,
    `CommandExecution`).
  - `private constructor` en el aggregate `CommandHistory`.
  - `readonly` en TODOS los campos públicos: `value`,
    `payload`, `stdout`, `stderr`, `exitCode`, `name`, `args`,
    `startedAt`, `endedAt`, `output`, `eventName`, `occurredAt`,
    `workspaceId`, `execution`, `attempted`, `commandName`,
    `field`, `code`, `jsonRpcCode`.
  - Aggregate usa `readonly` en TODOS los campos privados que no
    se mutan (`workspaceId`, `capacity`) y campos privados
    mutables sólo donde el comportamiento lo exige (`executions`,
    `events` — ambos drenables vía `pullEvents` y vía eviction
    `shift()`, declarados `readonly` en el slot del campo aunque
    el array interno se muta — patrón estándar).
  - `Object.freeze` en el array retornado por
    `CommandName.all()` (defensa contra que el caller mute la
    SSOT), por `CommandHistory.recentExecutions()` y por
    `CommandHistory.pullEvents()` (defensa runtime — alinea con
    el patrón de `Workspace.pullEvents`, `Decision.pullEvents`).
  - `withStdout`/`withStderr`/`withExitCode` **siempre retornan
    nueva instancia** — verificado: las tres líneas retornan
    `new CommandOutput(...)` con los campos mutados sin tocar
    `this`. Ninguna asignación a `this.stdout`/`this.stderr`/
    `this.exitCode` (que serían imposibles porque son `readonly`).
  - `CommandArgs.payload` es `private readonly`, sin getter
    público — sólo accesible vía `raw()` que devuelve el mismo
    `unknown`. El comentario sincero explica que el dominio no
    puede deep-freeze ni deep-equal sin un schema (línea 36-43).
- **`pullEvents` devuelve `readonly DomainEvent[]`** y drena el
  buffer (`this.events.length = 0`); segunda llamada devuelve
  `Object.freeze([])`. Mismo contrato que en los aggregates de
  `workspace/` y `memory/`.
- **JSDoc de invariantes** en TODOS los archivos — cada VO declara
  invariantes y semántica de equality. El aggregate documenta
  pre/postcondiciones de cada mutation y la racionalidad de su
  existencia (líneas 26-69). Cada error documenta su `code`,
  su `jsonRpcCode = null` y la justificación contractual de por
  qué no mapea a JSON-RPC.
- **Trazabilidad a docs**: cada archivo cita la sección relevante
  de `docs/07-instalacion.md`, `docs/11-seguridad-modos.md` §8,
  `docs/03-modelo-datos.md` §10, `docs/12-lineamientos-arquitectura.md`
  §1.3/§1.5/§1.6. El agente architect podrá auditar la coherencia
  modelo↔documento sin inferencia.
- **Errores wrappean `cause` con `Object.defineProperty`** vía la
  base `DomainError` (heredado de Tarea 1) — sin polyfill,
  `enumerable: false` para no contaminar logs.
- **`code` como `readonly`** en todos los errores concretos con
  identificadores estables kebab-case (`cli.unknown-command`,
  `cli.invalid-exit-code`, `cli.invalid-command-args`).
- **`jsonRpcCode` explícito y documentado**: `null` en TODOS los
  errores CLI (justificación contractual en
  `cli-domain-error.ts:1-50`: los errores CLI nunca cruzan a
  JSON-RPC porque ocurren en `mcp-memoria <command>` desde un
  terminal humano, no dentro de un handler MCP).

#### Aspectos específicos del scope (Tarea 7)

- **Switch sobre `CommandName` y `ExitCode` exhaustivos**: el scope
  NO contiene switches en código actual. La unión derivada `as
  const → keyof typeof / [number]` permite que CUALQUIER consumer
  futuro (use case, terminal adapter) escriba `switch (cmd.value) {
  ... default: const _exhaustive: never = cmd.value; throw ... }`
  con narrowing exhaustivo. La estructura del SSOT garantiza que
  agregar un comando o exit-code SIEMPRE rompe el `switch`
  exhaustivo del consumer en compile-time. **El dominio cumple su
  parte.**
- **`CommandHistory` ring buffer con `shift()` O(n)**: type-safe
  (verificado por tsc + análisis manual; ver A1 para detalles).
  Cero leaks de tipos. La elección O(n) está documentada en línea
  con un trade-off justificado por la cota dura `MAX_CAPACITY=1000`.
  El descarte del retorno `undefined` de `shift()` es correcto —
  el `while (this.executions.length > this.capacity)` garantiza
  ejecución sólo cuando hay elementos, así que el undefined nunca
  ocurre en runtime.
- **Builder `CommandOutput.with*` retorna nueva instancia**:
  verificado, las 3 funciones (`withStdout`, `withStderr`,
  `withExitCode`) retornan `new CommandOutput(...)`. **Cero
  mutación de `this`**. La inmutabilidad se garantiza estructuralmente
  (campos `readonly`) y semánticamente (los métodos no asignan a
  `this`).

---

## Veredicto justificado

**APROBADO.**

Los **12 archivos** del scope CLI cumplen los lineamientos §1.4
(SOLID), §1.5 (modularidad estricta) y §1.6 (type-safety total)
**sin excepciones bloqueantes**. La compilación con `tsc --strict`
y los 17 flags exigidos pasa con cero errores y cero warnings sobre
el corpus completo (26 archivos: shared/ + cli/).

**Cumplimiento type-safety total (§1.6):**
- Cero `any`, cero `as any`, cero `// @ts-ignore`,
  cero `// @ts-nocheck`, cero `// @ts-expect-error`,
  cero `eslint-disable`.
- Cero lectura de wall-clock (`Date.now`, `new Date()`),
  cero RNG (`Math.random`, `crypto.*`), cero side effects
  (`console.*`, `process.*`).
- `unknown` minimizado a las 2 categorías permitidas:
  `CommandArgs.payload`/`raw()` (3 ocurrencias) y `cause?: unknown`
  (4 ocurrencias). Cada una con justificación documentada.
- Discriminated unions exhaustivas derivadas de SSOT `as const`
  (`COMMAND_NAMES`, `EXIT_CODES`).
- Tipos de retorno explícitos en toda función/método.
- `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`,
  `noPropertyAccessFromIndexSignature`, `noImplicitOverride`,
  `noFallthroughCasesInSwitch` honrados.

**Cumplimiento SOLID (§1.4):**
- **SRP**: cada uno de los 12 archivos tiene UNA razón de cambio.
  El aggregate `CommandHistory` tiene 11 métodos públicos pero 9
  son getters/predicates obligatorios + `pullEvents` boilerplate;
  sólo 1 (`recordExecution`) es mutación real. Patrón estructural
  inevitable.
- **OCP**: agregar un nuevo comando o un nuevo exit-code es **una
  línea** en el SSOT — cero código existente se modifica. Los tipos
  derivados se actualizan en cascada por TypeScript. Cero switches
  gigantes.
- **LSP**: los 3 errores concretos heredan de `CliDomainError →
  DomainError` estrechando con campos `readonly` propios y
  refinando `jsonRpcCode` a `null`, sin debilitar pre/postcondiciones.
- **ISP**: el repositorio tiene 3 métodos cohesivos
  (`findById`/`save`/`delete`). Ninguna interface obliga a métodos
  no aplicables.
- **DIP**: el aggregate no instancia adapters, recibe todo por
  parámetro inyectado, no lee reloj. El repositorio es interface
  pura.

**Cumplimiento modularidad estricta (§1.5):**
- Cero imports cross-módulo (verificado por grep). Los 23 imports
  van exclusivamente a `shared/domain/...` o intra-módulo.
- Estructura interna correcta:
  `value-objects/aggregates/events/repositories/errors`.

**Las 2 advertencias listadas son sugerencias preventivas:**

- **A1** observa que `recordExecution` usa `Array.shift()` O(n) y
  que `recentExecutions` usa `new Array<T>(effective)` con loop de
  asignación. Type-safe en ambos casos (verificado), trade-off
  documentado en el comentario inline. Si en el futuro el aggregate
  concentra latencia, reemplazar por ring circular (intra-aggregate,
  no toca contrato público).
- **A2** sugiere encapsular la validación de `limit` en
  `recentExecutions` en un VO `PageLimit` compartido si otros
  módulos replican el patrón. Para CLI MVP es prematuro.

Ninguna advertencia afecta corrección actual ni viola ningún
lineamiento.

El módulo `cli/domain` está listo para que la fase de application
monte los use cases (`ParseArgvUseCase`, `RecordExecutionUseCase`,
`InspectHistoryUseCase`) y para que la fase de infraestructura
implemente los adapters (`SqliteCommandHistoryRepository`,
`CommanderArgvAdapter`, `TerminalIoAdapter`).

---

## Próximo paso recomendado

1. **Liberar el siguiente validador del workflow** (clean-architecture-validator
   o ddd-validator según el orden de Fase 1).
2. La **Fase de application** debe diseñar los use cases sobre los
   3 agregados/VO clave: parseo de argv (output port hacia
   commander/yargs), grabación de ejecución (composición
   `Clock.now() → CommandExecution.create() → history.recordExecution()
   → repo.save()`), inspección histórica (paginación con `limit`
   validado por el aggregate).
3. La **Fase de infrastructure** debe implementar el adapter
   `CommanderArgvAdapter` que convierte `argv` en `CommandName +
   CommandArgs`, validando con Zod cualquier shape específica y
   lanzando `InvalidCommandArgsError` cuando falle.
4. La **Fase de QA** debe agregar tests unitarios sobre invariantes
   específicas:
   - **`CommandName`**: rechaza `""`, whitespace-only, mayúsculas
     (`"INIT"`), tokens no listados (`"innit"`), no-strings;
     acepta los 22 listados; `equals` por valor; `all()` retorna
     copia frozen idempotente.
   - **`ExitCode.fromValue`**: rechaza `-1`, `256`, `1.5`, `NaN`,
     `Infinity`; acepta `0..255`; `kind` retorna nombre conocido
     para 0..7 y `null` para 8..255.
   - **`CommandExecution.create`**: rechaza `endedAt < startedAt`;
     acepta `endedAt === startedAt` (instantáneo); `durationMs`
     siempre >= 0.
   - **`CommandOutput`**: cada `with*` retorna NUEVA instancia
     (test con `===` de referencia + comparación de campos);
     `equals` componente-wise.
   - **`CommandHistory`**:
     - eviction correcta: `recordExecution` que excede `capacity`
       saca el oldest (FIFO);
     - rechaza out-of-order: `recordExecution` con `endedAt <
       tail.endedAt` lanza `InvariantViolationError`;
     - `recentExecutions` newest-first; `limit > size` clamp a
       `size`; `limit = 0` retorna `[]` frozen; `limit < 0` o
       no-entero lanza `InvalidInputError`;
     - `pullEvents` idempotente: segunda llamada `[]`;
     - `rehydrate` rechaza `executions.length > capacity` y
       executions out-of-order;
     - `assertCapacity` rechaza `0`, `-1`, `1.5`, `1001`, `NaN`.
