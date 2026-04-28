# SOLID + Type-Safety Validation — Phase 1, Task 2: workspace/domain
**Validator:** solid-validator
**Date:** 2026-04-27
**Verdict:** APROBADO (con 3 advertencias menores no bloqueantes)

---

## Resultado de tsc estricto

**PASS — exit code 0, cero errores, cero warnings.**

Comando ejecutado (TypeScript 6.0.3, project copia en `/tmp/tsc-validate-task2`):

```
tsc --noEmit -p tsconfig.json
```

Con `tsconfig.json` que incluye TODOS los flags exigidos por §1.6
(idéntico al de Tarea 1):

```jsonc
{
  "target": "ES2022",
  "module": "ESNext",
  "moduleResolution": "bundler",
  "allowImportingTsExtensions": true,
  "strict": true,
  "noImplicitAny": true,
  "strictNullChecks": true,
  "strictFunctionTypes": true,
  "strictBindCallApply": true,
  "strictPropertyInitialization": true,
  "noImplicitThis": true,
  "alwaysStrict": true,
  "noUnusedLocals": true,
  "noUnusedParameters": true,
  "exactOptionalPropertyTypes": true,
  "noImplicitReturns": true,
  "noFallthroughCasesInSwitch": true,
  "noUncheckedIndexedAccess": true,
  "noImplicitOverride": true,
  "noPropertyAccessFromIndexSignature": true,
  "isolatedModules": true,
  "forceConsistentCasingInFileNames": true,
  "skipLibCheck": true
}
```

`include`: `src/shared/domain/**/*.ts` + `src/modules/workspace/domain/**/*.ts`.
Resultado: **`Exit code: 0`**. Los 16 archivos del módulo `workspace/domain`
(más los 14 del módulo transversal `shared/domain` ya validados en
Tarea 1) compilan limpio bajo el régimen estricto completo.

### Auditoría grep complementaria

| Patrón | Matches en posición de tipo |
|---|---|
| `\bany\b` (palabra) | 0 reales (7 falsos positivos en JSDoc inglés: "any read/write", "any UI", "any other mode", "any side effect", "any in-process", "any event", "any title") |
| `: any` | 0 |
| `as any` | 0 |
| `<any>` | 0 |
| `// @ts-ignore` | 0 |
| `// @ts-nocheck` | 0 |
| `// @ts-expect-error` | 0 |
| `Promise<any>` / `Array<any>` | 0 |
| Casts (` as `) en posición de tipo | **0** — todos los " as " son texto JSDoc inglés ("kept as a string", "as the default", "as a deliberate", "as an invariant", "as unlocked", "as `WorkspaceMode`", "as 'not found'") |

### Auditoría de modularidad estricta (§1.5)

`grep -rEn "from \"" code/src/modules/workspace/domain/` produjo
**44 imports**, **todos** clasificables en exactamente dos categorías:

1. Imports relativos a `../../../../shared/domain/...` — **PERMITIDOS** por §1.5.
2. Imports intra-módulo (`../value-objects/`, `../events/`,
   `../errors/`, `./...`) — **PERMITIDOS** por §1.5.

**Cero imports** desde `modules/memory/`, `modules/encryption/`,
`modules/secrets/`, `modules/curator/`, `modules/retrieval/`,
`modules/mcp-server/` o `modules/cli/`. La regla de modularidad
estricta se cumple sin excepciones.

---

## Hallazgos

### CRÍTICOS (bloquean aprobación)

**Ninguno.** El código cumple §1.4 (SOLID), §1.5 (modularidad estricta) y
§1.6 (type-safety total) sin violaciones bloqueantes.

### ADVERTENCIAS (no bloqueantes — preventivas o estilísticas)

#### A1. SRP / tamaño — `Workspace` aggregate roza el umbral heurístico
- **Archivo:** `code/src/modules/workspace/domain/aggregates/workspace.ts`
- **Métricas:** 315 líneas (>200 = umbral de revisión heurístico
  declarado en este validator), 13 métodos públicos visibles
  (>7 = umbral). El recuento bruto sobrepasa los umbrales pero la
  semántica está cohesionada: 2 factories (`initialize`, `rehydrate`),
  3 mutaciones del state machine (`changeMode`, `unlock`, `lock`), 2
  asserts de invariantes (`assertNotAlreadyInitialized`,
  `assertReadyForUse`), 5 queries (`getId`, `getConfig`, `getMode`,
  `isUnlocked`, `isLocked`) y 1 drenaje de buffer (`pullEvents`).
  La "razón de cambio" es única: *cambian las reglas del workspace*
  (modo, lock state, identidad). Cada bloque agrega contexto, no
  responsabilidad nueva.
- **Conclusión:** SRP **no** violado. La métrica supera el umbral
  porque un aggregate root concentra reglas que el dominio exige tener
  juntas (la matriz de transición, los asserts y los getters viven
  donde están las invariantes). Documentar la decisión es suficiente.
- **Fix sugerido (preventivo):** si en el futuro se agregan
  responsabilidades ortogonales (audit log, snapshotting, replay), se
  extrae un `WorkspaceModeStateMachine` privado para que el agregado
  delegue las transiciones y siga teniendo una sola razón de cambio.

#### A2. Diseño defensivo — `assertNotAlreadyInitialized()` siempre lanza
- **Archivo:** `code/src/modules/workspace/domain/aggregates/workspace.ts:143-145`
- **Detalle:** El método **siempre** lanza
  `WorkspaceAlreadyInitializedError`. Es un assert "incondicional"
  pensado para que el caller que ya rehidrató un agregado pueda
  rechazar un re-init explícitamente. La intención está documentada
  (líneas 137-142), pero el patrón es contraintuitivo: el lector espera
  que un `assertX()` valide una condición y, sólo si falla, lance.
  Este método no valida nada — su existencia ES el rechazo. No viola
  SRP ni LSP, pero podría confundir y se podría inferir mal el contrato
  con autocompletado.
- **Conclusión:** No bloqueante. La doc lo justifica.
- **Fix sugerido (claridad):** renombrar a `rejectReinitialization()`
  o `markAsAlreadyInitialized()` para que el nombre comunique que el
  método **siempre** falla. Alternativamente, mover la responsabilidad
  al use case (la application layer crea el error directamente cuando
  detecta que `repository.findById(id)` ya devolvió un agregado), lo
  que evita el método "siempre tira" del agregado.

#### A3. OCP / mantenibilidad — duplicación de catálogos `readonly` para enums string
- **Archivos:**
  - `code/src/modules/workspace/domain/value-objects/workspace-mode.ts:11-21`
    declara `WorkspaceModeKind` (union literal) **y** un array
    `WORKSPACE_MODE_KINDS` con los mismos tres valores.
  - `code/src/modules/workspace/domain/value-objects/embedder-spec.ts:16-22`
    declara `EmbedderProvider` (union literal) **y** un array
    `EMBEDDER_PROVIDERS` con los mismos tres valores.
- **Detalle:** El patrón es el canónico para validar strings entrantes
  contra una unión literal sin recurrir a `as`. El compilador no puede
  derivar el array desde la union (TS no tiene
  "values-of-string-literal-union" automático), así que hay que
  duplicar manualmente. La duplicación está aislada al inicio del
  archivo y los `Object.freeze` previenen mutación, pero si alguien
  agrega un nuevo `WorkspaceModeKind` y olvida agregarlo al array, el
  type guard `isKind` dejará pasar el nuevo valor en compile-time
  (la union lo conoce) pero lo rechazará en runtime — un bug sigiloso
  que sólo se ve en un test.
- **Conclusión:** No es violación de OCP en el sentido del lineamiento
  (la extensión sigue siendo "agregar una nueva variante en un único
  punto"), pero el "único punto" son **dos lugares**.
- **Fix sugerido (preventivo, especialmente cuando aparezcan más
  enums en otros módulos):** invertir la dirección — declarar el array
  `as const` y derivar la union desde él, igual que ya se hace en
  `JsonRpcErrorCodes`:

  ```typescript
  const WORKSPACE_MODE_KINDS = ["shared", "encrypted", "private"] as const;
  export type WorkspaceModeKind = (typeof WORKSPACE_MODE_KINDS)[number];
  ```

  Así un nuevo modo se agrega en un solo sitio y la union se sincroniza
  automáticamente. Aplica idéntico a `EMBEDDER_PROVIDERS`.

### POSITIVOS

#### SOLID (§1.4)

- **SRP** — Cada VO encapsula UN concepto (`WorkspaceMode`,
  `WorkspacePath`, `DisplayName`, `EmbedderSpec`, `WorkspaceConfig`).
  Cada error representa UNA falla específica
  (`InvalidModeTransitionError` ≠ `WorkspaceLockedError` ≠
  `WorkspaceAlreadyInitializedError`). Cada evento captura UN hecho del
  pasado. `WorkspaceConfig` orquesta seis sub-VOs sin lógica adicional
  más allá del control de versionado y la composición de `with*` para
  inmutabilidad — su única responsabilidad es "ser la foto del
  config.json".
- **OCP** — Cero `if (kind === "X")` proliferando: `WorkspaceMode`
  expone `isShared()`, `isEncrypted()`, `isPrivate()`, `requiresKey()`
  como predicados encapsulados; el consumidor pregunta por capacidad
  (`requiresKey()`), no por tag. La matriz de transiciones
  (`ALLOWED_TRANSITIONS`) está en una constante `Object.freeze`d que
  se extiende **agregando filas**, no modificando código existente.
  `EmbedderSpec.isFastembed()/isVoyage()/isOpenAi()` cumple el mismo
  patrón. Nuevos providers o modos requieren agregar una entrada al
  array literal y el handler correspondiente — no tocar la lógica
  central de `WorkspaceConfig` ni del aggregate.
- **LSP** — `DisplayName extends NonEmptyString` con `override create`
  (línea 50) que **estrecha** la postcondición del padre (devuelve
  `DisplayName` en vez de `NonEmptyString`) y agrega validaciones sin
  contradecir las del padre. La equality heredada de `NonEmptyString`
  incluye `other.constructor !== this.constructor` (sibling-safe), por
  lo que dos `DisplayName` se comparan correctamente y nunca se
  confunden con un `NonEmptyString` "puro". Los errores son LSP-puros:
  `WorkspaceLockedError`, `InvalidModeTransitionError` y
  `WorkspaceAlreadyInitializedError` extienden `WorkspaceDomainError`
  → `DomainError` → `Error` sin estrechar nada. El catch genérico
  `instanceof DomainError` o `instanceof WorkspaceDomainError` los
  capturará a todos.
- **ISP** — `WorkspaceRepository` tiene **2 métodos** (`findById`,
  `save`). `WorkspaceDetector` tiene **1 método** (`detect`).
  `DomainEvent` (heredada de `shared`) tiene **2 campos**. Ninguna
  interface obliga a un implementador a definir métodos que no
  necesita. El umbral de "≥5 miembros = sospechar" no se cruza en
  ningún lado.
- **DIP** — El aggregate `Workspace` **no instancia adapters**: recibe
  todo lo que necesita (`config: WorkspaceConfig`, `occurredAt:
  Timestamp`, `newMode: WorkspaceMode`) por parámetro. No hace `new
  SomeAdapter(...)` en ninguna línea. `WorkspaceRepository` y
  `WorkspaceDetector` son **interfaces puras** (no abstract classes,
  no defaults), declaradas en el dominio para que las implementaciones
  vivan en `infrastructure/`. El dominio nunca lee el reloj —
  `Timestamp` siempre llega como parámetro inyectado por la
  composition root vía el puerto `Clock` (consistente con
  `Timestamp.now(clockMs)` validado en Tarea 1).

#### Modularidad estricta (§1.5)

- **Cero imports cross-módulo.** Los 44 imports listados van
  exclusivamente a `shared/domain/` o a paths intra-módulo.
- **Estructura interna correcta**: `value-objects/`, `aggregates/`,
  `events/`, `repositories/`, `services/`, `errors/`. El módulo
  declara contenedores DDD canónicos sin mezclar capas.
- **El aggregate importa puertos como `interface` puros** (no como
  clases concretas) — `WorkspaceRepository` y `WorkspaceDetector`
  viven dentro del propio módulo, no en `shared/`, porque son
  específicos del bounded context. Esto es correcto: §1.5 dice
  "puertos comunes" en `shared/application/ports/`, pero los puertos
  específicos de un módulo se quedan en su propio dominio.

#### Type-safety total (§1.6)

- **Cero `any`** en posición de tipo, confirmado por grep + por que
  `tsc --strict --noImplicitAny` pasa limpio.
- **Cero casts (` as `)** en código TS — los 7 hits del grep son
  todos texto JSDoc inglés. Esto contrasta con `shared/domain` (Tarea
  1) donde hay 3 casts canónicos para brand attribution; el módulo
  workspace no necesita inventar nuevos brands porque reutiliza
  `WorkspaceId` desde `shared`.
- **Cero `// @ts-ignore` / `// @ts-nocheck` / `// @ts-expect-error`**.
- **Tipos de retorno explícitos** en TODA función/método: factories
  (`WorkspaceMode.create(): WorkspaceMode`), helpers privados
  (`looksAbsolute(candidate: string): boolean`), getters
  (`isLocked(): boolean`), incluyendo el método "always-throws"
  `assertNotAlreadyInitialized(): void`. Cero inferencia implícita
  en superficie pública.
- **`exactOptionalPropertyTypes` honrado** — los `options?: { cause?:
  unknown }` en los constructores de error usan el patrón explícito
  `options !== undefined ? { cause: options.cause } : undefined`
  (`workspace-locked-error.ts:31`,
  `invalid-mode-transition-error.ts:50`,
  `workspace-already-initialized-error.ts:30-31`,
  `workspace-domain-error.ts:25`) para no construir un objeto con
  `cause: undefined`, que `exactOptionalPropertyTypes` rechazaría.
- **`noUncheckedIndexedAccess` honrado** —
  `workspace-mode.ts:96-97` y `embedder-spec.ts:226-227` hacen
  `if (known !== undefined && known === candidate) return true;`
  antes de comparar el elemento del array. `embedder-spec.ts:175-184`
  comprueba `if (canonical !== undefined)` después de
  `FASTEMBED_MODEL_DIMENSIONS[model]`. `workspace.ts:308-313` chequea
  `if (allowed === undefined) return false;` antes del bucle.
- **`noPropertyAccessFromIndexSignature` honrado** — los Records con
  index signature (`ALLOWED_TRANSITIONS`,
  `FASTEMBED_MODEL_DIMENSIONS`) se acceden con bracket notation
  (`ALLOWED_TRANSITIONS[from.toString()]`,
  `FASTEMBED_MODEL_DIMENSIONS[model]`), nunca con dot notation que
  tsc rechazaría.
- **`noImplicitOverride` honrado** —
  `display-name.ts:50` declara `public static override create(...)`
  con la palabra explícita.
- **Discriminated unions correctos**:
  - `WorkspaceModeKind = "shared" | "encrypted" | "private"` con type
    guard `isKind(): candidate is WorkspaceModeKind`.
  - `EmbedderProvider = "fastembed" | "voyage" | "openai"` con type
    guard `isProvider(): candidate is EmbedderProvider`.
  - `WorkspaceDetectionResult` (`workspace-detector.ts:20-22`) es una
    discriminated union ejemplar sobre `exists: true | false`, con
    `configPath: WorkspacePath` cuando `exists: true` y
    `configPath: null` cuando `exists: false`. Imposible
    dereferenciar un path stale.
  - `eventName` literal en cada evento
    (`"workspace.initialized"`, `"workspace.mode-changed"`,
    `"workspace.locked"`, `"workspace.unlocked"`) → un subscriber
    puede hacer `switch (event.eventName)` con narrowing exhaustivo.
- **Inmutabilidad disciplinada**: `private constructor` en todos los
  VO concretos (`WorkspaceMode`, `WorkspacePath`, `DisplayName`,
  `EmbedderSpec`, `WorkspaceConfig`); `readonly` en TODOS los campos
  públicos del aggregate y de los eventos; `Object.freeze` en
  `WORKSPACE_MODE_KINDS`, `EMBEDDER_PROVIDERS`,
  `FASTEMBED_MODEL_DIMENSIONS`, `ALLOWED_TRANSITIONS` y en el array
  retornado por `pullEvents()`. El método `pullEvents()` devuelve
  `readonly DomainEvent[]` y vacía el buffer interno
  atómicamente (`this.events.length = 0;` en línea 298) para
  garantizar que las llamadas sucesivas no devuelven duplicados.
- **`Workspace.changeMode` aplica `withMode` (inmutable)** sobre el
  config en vez de mutar el campo — el config interno se reemplaza
  por una nueva instancia (`this.config = this.config.withMode(...)`,
  línea 179). Compatible con Object identity y futuros snapshotters.
- **JSDoc de invariantes** en todos los archivos — cada VO declara
  invariantes y semántica de equality. Cada error documenta su
  `code`, su `jsonRpcCode` (cuando aplica) y por qué se eligió ese
  mapeo (la justificación de **no** asignar JSON-RPC a
  `InvalidModeTransitionError` está explícita en líneas 29-36 del
  archivo).
- **Trazabilidad a docs**: cada archivo cita la sección relevante de
  `docs/03-modelo-datos.md`, `docs/11-seguridad-modos.md`,
  `docs/02-protocolo-mcp.md` o `docs/01-arquitectura.md`. El agente
  architect podrá auditar la coherencia modelo↔documento sin
  inferencia.
- **Errores wrappean `cause` con `Object.defineProperty`** vía la
  base `DomainError` — sin polyfill, `enumerable: false` para no
  contaminar logs.
- **`code` como `readonly`** en todos los errores concretos con
  identificadores estables kebab-case
  (`workspace.invalid-mode-transition`, `workspace.locked`,
  `workspace.already-initialized`).
- **`pullEvents` devuelve `readonly DomainEvent[]`** (no
  `DomainEvent[]`) para evitar que el caller mute el buffer. El
  `Object.freeze` sobre el snapshot drenado es defensa adicional en
  runtime.

---

## Veredicto justificado

**APROBADO.**

Los 16 archivos del scope cumplen los lineamientos §1.4 (SOLID), §1.5
(modularidad estricta) y §1.6 (type-safety total) **sin excepciones
bloqueantes**. La compilación con `tsc --strict` y los 17 flags exigidos
pasa con cero errores y cero warnings. No hay ningún `any`, ningún
`// @ts-ignore`/`// @ts-nocheck`/`// @ts-expect-error`, y no se
introdujo NINGÚN cast (` as ` en posición de tipo) — ni siquiera los
brand attributions canónicos que sí aparecen en `shared` para
`WorkspaceId`. Esto es estrictamente mejor que el módulo transversal
porque `workspace/domain` consume `WorkspaceId` ya construido sin
necesidad de re-marcar.

Las 3 advertencias listadas son sugerencias estilísticas /
preventivas:

- **A1** observa que `Workspace.ts` (315 líneas, 13 públicos) supera
  los umbrales heurísticos pero la cohesión semántica está justificada
  y se trata de un aggregate root.
- **A2** sugiere renombrar `assertNotAlreadyInitialized` para que el
  nombre comunique que **siempre** lanza (no es un assert
  condicional).
- **A3** propone invertir la fuente de verdad de las uniones literales
  (array `as const` → union derivada) en `WorkspaceMode` y
  `EmbedderSpec` para eliminar la duplicación entre la union y el
  array de validación.

Ninguna afecta corrección actual ni viola ningún lineamiento.

El cumplimiento DIP es ejemplar: el aggregate no instancia adapters,
los puertos `WorkspaceRepository` y `WorkspaceDetector` son interfaces
puras, y todos los timestamps llegan como parámetro inyectado. El
cumplimiento de la regla de modularidad estricta (§1.5) es absoluto:
cero imports cross-módulo, todo va a `shared/domain/` o intra-módulo.

El módulo `workspace/domain` está listo para que la fase de
infraestructura implemente los adapters
(`infrastructure/persistence/json-file-workspace-repository.ts`,
`infrastructure/services/fs-workspace-detector.ts`) y para que la fase
de application monte los use cases (`InitializeWorkspaceUseCase`,
`UnlockWorkspaceUseCase`, `ChangeModeUseCase`).

---

## Próximo paso recomendado

1. **Liberar `domain-architect` para Tarea 3 de Fase 1** (puertos
   compartidos en `shared/application/ports/`: `Clock`, `IdGenerator`,
   `Logger`, `Database`, `Embedder`, `KDF`).
2. Considerar A2 antes de cerrar la fase: renombrar
   `assertNotAlreadyInitialized` a `rejectReinitialization` (o
   eliminar el método y delegar la responsabilidad al use case)
   eliminaría confusión sin coste.
3. Cuando se introduzcan más unions literales en otros módulos
   (`MemoryEntryKind`, `RetrievalLayer`, etc.), aplicar el patrón
   `as const`-array → union derivada de A3 desde el primer commit
   para no propagar la duplicación.
4. La Fase de QA debe agregar tests unitarios de cobertura completa
   sobre invariantes específicas: matriz de transiciones (incluyendo
   los rechazos `encrypted -> shared` y `shared -> shared`),
   `unlock`/`lock` en modos no-encrypted, `pullEvents` idempotencia,
   `WorkspacePath` en POSIX/Windows/UNC, validación de
   `EmbedderSpec` con `fastembed` modelo desconocido sin `dim`,
   colisión de `dim` declarado vs catálogo canónico,
   `WorkspaceConfig.withMode` retornando `this` en self-transition.
