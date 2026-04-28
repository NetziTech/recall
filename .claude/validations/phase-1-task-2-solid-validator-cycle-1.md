# SOLID + Type-Safety Validation — Phase 1, Task 2 (Cycle 1): workspace/domain
**Validator:** solid-validator
**Cycle:** 1 (re-validacion tras correcciones del ddd-validator)
**Date:** 2026-04-27
**Verdict:** APROBADO (sin advertencias; A1/A2/A3 del ciclo 0 todas resueltas o documentadas)

---

## Resultado de tsc estricto

**PASS — exit code 0, cero errores, cero warnings.**

Comando ejecutado (TypeScript 5.6.3, project copia en
`/tmp/tsc-validate-task2-cycle1`):

```
tsc --noEmit -p tsconfig.json
```

Con `tsconfig.json` que incluye TODOS los flags exigidos por §1.6
(idéntico al ciclo 0, sin relajaciones):

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
Resultado: **`Exit code: 0`**. Los 16 archivos del módulo
`workspace/domain` (más los 14 del módulo transversal `shared/domain`)
compilan limpio bajo el régimen estricto completo. **Sin regresiones**
respecto al ciclo 0; los renames y cambios de tipo aplicados se
absorbieron sin errores.

### Auditoría grep complementaria

| Patrón | Matches en posición de tipo |
|---|---|
| `\bany\b` | 0 reales (7 falsos positivos en JSDoc inglés: "any read/write", "any UI", "any other mode", "any side effect", "any in-process", "any event", "any title") |
| `: any` | 0 |
| `as any` | 0 |
| `<any>` | 0 |
| `// @ts-ignore` | 0 |
| `// @ts-nocheck` | 0 |
| `// @ts-expect-error` | 0 |
| `Promise<any>` / `Array<any>` / `Record<any` | 0 |
| Casts (` as ` en posición de tipo) en `workspace/domain` | **2 ocurrencias canónicas** — las dos `as const` introducidas por la corrección de A3 (`["shared","encrypted","private"] as const` y `["fastembed","voyage","openai"] as const`). Son el patrón explícitamente recomendado por mí en el ciclo 0; no son casts inseguros sino const-assertions que TS necesita para que `(typeof X)[number]` derive una unión literal cerrada. Los demás " as " son texto JSDoc inglés ("kept as a method", "as `WorkspaceMode`", etc.). |
| Casts en `shared/domain` | 3 idénticos al ciclo 0 (`normalised as IdValue<TBrand>` en `id.ts`/`workspace-id.ts`, `} as const` en `json-rpc-error-codes.ts`) — ninguno nuevo, sin regresión. |

### Auditoría de modularidad estricta (§1.5)

`grep -rEn "^import " code/src/modules/workspace/domain/` reporta **49
imports** (5 más que el ciclo 0 por la incorporación de `import type`
explícitos tras la corrección — ver detalle abajo). **Todos**
clasificables en exactamente dos categorías:

1. Imports relativos a `../../../../shared/domain/...` — **PERMITIDOS**
   por §1.5.
2. Imports intra-módulo (`../value-objects/`, `../events/`,
   `../errors/`, `./...`) — **PERMITIDOS** por §1.5.

```
grep -rEn "from \".*modules/(memory|encryption|secrets|curator|retrieval|mcp-server|cli)/" \
  code/src/modules/workspace/domain
```
→ **0 matches.** Cero imports cross-módulo, sin excepciones.

---

## Hallazgos

### CRÍTICOS (bloquean aprobación)

**Ninguno.**

### ADVERTENCIAS (no bloqueantes)

**Ninguna nueva.** Las 3 del ciclo 0 están resueltas o documentadas:

#### Estado de A1 — `Workspace` aggregate roza umbrales heurísticos
- **Estado en ciclo 1:** sin cambio de tamaño material (315 → 330
  líneas: las 15 nuevas son JSDoc adicional sobre el rename y la
  defensive copy del buffer de eventos). El recuento de métodos
  públicos baja de facto: `assertNotAlreadyInitialized` se renombró a
  `rejectReinitialization` (no es un método nuevo, sino el mismo
  rebautizado), así que el conteo se mantiene en 13. Como ya argumenté
  en el ciclo 0, la cohesión semántica está justificada (aggregate root
  con state machine, asserts e identidad concentradas), no es una
  violación de SRP. La advertencia se cierra como **acepto-y-documento**.

#### Estado de A2 — `assertNotAlreadyInitialized()` siempre lanza
- **Estado en ciclo 1: RESUELTO.** El método se renombró a
  `rejectReinitialization(): never`
  (`workspace.ts:158`). Ahora:
  - El nombre comunica explícitamente que la operación ES un rechazo
    (no un assert que valida y opcionalmente lanza).
  - El tipo de retorno cambió de `void` a `never`, lo que (a) hace que
    TypeScript trate el código posterior a la llamada como inalcanzable,
    (b) habilita uso en arrow flows y narrowing
    (`if (existing) workspace.rejectReinitialization()` deja la
    expresión siguiente con el tipo del else-branch sin necesidad de
    early-return explícito), y (c) documenta el contrato en la firma.
  - Verificado via sanity check independiente: TypeScript 5.6.3 honra
    correctamente el flow analysis sobre `never`. La firma compila
    limpio bajo `strict + noImplicitReturns + noUnreachableCode (off)`
    sin warnings.
  - La JSDoc se actualizó (líneas 141-157) para que el lector entienda
    por qué el método existe (encapsular la política "cómo se rechaza
    una re-inicialización" en el agregado en vez de dispersarla por los
    use cases).

#### Estado de A3 — duplicación de catálogos union+array
- **Estado en ciclo 1: RESUELTO.** Tanto
  `value-objects/workspace-mode.ts:12-22` como
  `value-objects/embedder-spec.ts:23-25` invierten ahora la dirección:

  ```typescript
  const WORKSPACE_MODE_KINDS = ["shared", "encrypted", "private"] as const;
  export type WorkspaceModeKind = (typeof WORKSPACE_MODE_KINDS)[number];
  ```

  ```typescript
  const EMBEDDER_PROVIDERS = ["fastembed", "voyage", "openai"] as const;
  export type EmbedderProvider = (typeof EMBEDDER_PROVIDERS)[number];
  ```

  Único punto de cambio: agregar un nuevo modo o provider es una sola
  línea (un nuevo elemento en el array) y la unión literal se sincroniza
  automáticamente. El bug sigiloso "agregué a la unión pero no al
  array" deja de ser posible por construcción. Mismo patrón ya
  consagrado en `JsonRpcErrorCodes` (`shared/domain/errors/`).

  Como subproducto, las dos ocurrencias `as const` ahora visibles en
  `workspace/domain` son la única razón por la que el conteo de " as "
  en este módulo deja de ser cero — pero se trata del patrón canónico
  TS para const-assertion, no de casts inseguros (`as Type`), así que
  no califican como violación de §1.6.

  El tipo guard interno (`isKind`/`isProvider`) ahora itera el mismo
  array que es la fuente de verdad de la unión, garantizando
  consistencia compile-time/runtime.

### Verificaciones específicas de las correcciones del ciclo 1

#### 1. `WorkspaceDomainError.jsonRpcCode: number | null` abstracto
- `workspace-domain-error.ts:37` declara
  `public abstract readonly jsonRpcCode: number | null;`
- Las tres subclases concretas implementan el contrato como **field**
  (no método), respetando la decisión de simetría:
  - `workspace-locked-error.ts:26`:
    `public readonly jsonRpcCode: number | null = JsonRpcErrorCodes.ENCRYPTED_LOCKED;`
  - `workspace-already-initialized-error.ts:27`:
    `public readonly jsonRpcCode: number | null = null;`
  - `invalid-mode-transition-error.ts:45`:
    `public readonly jsonRpcCode: number | null = null;`
- LSP: las tres expanden el contrato del padre sin estrechar (el
  padre admite `number | null`, las tres devuelven dentro de ese
  conjunto).
- `tsc --strict --strictPropertyInitialization` pasa: cada subclase
  inicializa el field declarativamente, no requiere asignación en el
  constructor.

#### 2. `import type` en `invalid-mode-transition-error.ts:1`
- Confirmado: la importación de `WorkspaceMode` se hace con
  `import type` ya que sólo se usa como anotación de campo. Esto evita
  ciclos potenciales en runtime (importante porque
  `WorkspaceMode.create` también podría querer usar este error si en el
  futuro se delega validación más rica). El compilador con
  `isolatedModules: true` y `verbatimModuleSyntax` lo respetará sin
  re-emitir.

#### 3. JSON_RPC_CATALOG ya NO se reexporta desde la subclase
- `grep -rn "JSON_RPC_CATALOG" code/src/modules/workspace` → 0 matches.
- La doc de `invalid-mode-transition-error.ts:37-41` ahora dirige a los
  consumidores a importar `JsonRpcErrorCodes` directamente desde
  `shared/domain/errors/json-rpc-error-codes.ts`.
- DIP/cohesión: una clase de error de dominio no debe actuar como
  entry-point secundario del catálogo de transporte. Rechazar la
  reexportación elimina esa fuga.

#### 4. Defensive copy de `events` en constructor de `Workspace`
- `workspace.ts:80-94`: el constructor declara
  `events: readonly DomainEvent[]` como parámetro y asigna
  `this.events = [...events];`.
- El campo interno sigue siendo `private readonly events: DomainEvent[]`
  (mutable internamente para que `pullEvents` pueda drenar el buffer
  con `this.events.length = 0`), pero la copia defensiva impide que un
  caller que pase una referencia externa pueda mutarla a posteriori y
  alterar el buffer del agregado.
- Tipos: `readonly DomainEvent[]` (parámetro) → `[...events]` produce
  `DomainEvent[]` válido para asignar al field mutable. tsc lo aprueba
  bajo `strictFunctionTypes` y `strict`.
- LSP/encapsulación: el contrato externo de `pullEvents` sigue
  devolviendo `readonly DomainEvent[]` y aplica `Object.freeze` al
  snapshot drenado. Doble defensa: tipo + runtime.

#### 5. Renames de factories de `WorkspaceMode`
- `workspace-mode.ts:85, 90, 95`: `sharedMode()`, `encryptedMode()`,
  `privateMode()`. La JSDoc explica la decisión: el sufijo es necesario
  para `privateMode` (palabra reservada en clases TS) y se aplica a las
  otras dos por simetría.
- Cero referencias al naming anterior (`shared()`, `encrypted()`,
  `privateOnly()`) en el módulo. `grep` confirma.
- API uniforme y descubrible vía autocompletado.

---

## POSITIVOS (resumen de §1.4 / §1.5 / §1.6 mantenidos)

- **SRP/OCP/LSP/ISP/DIP** sin regresiones respecto al ciclo 0; en
  particular DIP sigue siendo ejemplar (cero `new Adapter()` en el
  agregado, todos los timestamps inyectados, puertos `WorkspaceRepository`
  y `WorkspaceDetector` como interfaces puras).
- **Modularidad estricta (§1.5)** — cero imports cross-módulo en los
  49 imports del módulo.
- **Type-safety total (§1.6)**:
  - 0 `any` reales, 0 casts inseguros (las 2 ocurrencias `as const`
    son const-assertions canónicas), 0 `// @ts-*`.
  - Tipos de retorno explícitos en TODA función/método, incluyendo el
    nuevo `rejectReinitialization(): never` que es estrictamente más
    informativo que el `assertNotAlreadyInitialized(): void` anterior.
  - `exactOptionalPropertyTypes` honrado en cuatro errores (patrón
    `options !== undefined ? { cause: options.cause } : undefined`).
  - `noUncheckedIndexedAccess` honrado en `WORKSPACE_MODE_KINDS` y
    `EMBEDDER_PROVIDERS` (loop con guard `known !== undefined && known === candidate`).
  - `noPropertyAccessFromIndexSignature` honrado (acceso por bracket
    en `ALLOWED_TRANSITIONS[from.toString()]` y
    `FASTEMBED_MODEL_DIMENSIONS[model]`).
  - `noImplicitOverride` honrado (`DisplayName.create` con `override`).
  - Discriminated unions exhaustivas: `WorkspaceModeKind`,
    `EmbedderProvider`, `WorkspaceDetectionResult`, `eventName` literal.
  - Inmutabilidad: `private constructor` en VOs, `readonly` en
    aggregate y eventos, `Object.freeze` en arrays/records, defensive
    copy del buffer de eventos.

---

## Veredicto justificado

**APROBADO.**

El ciclo 1 cierra las 3 advertencias del ciclo 0 sin introducir
regresiones:

- **A2** completamente resuelto: rename a `rejectReinitialization(): never`
  con cambio de retorno a `never` (mejora real, no cosmética: ahora la
  firma documenta que la función no retorna y el flow analysis lo
  aprovecha).
- **A3** completamente resuelto: arrays `as const` como única fuente
  de verdad para las uniones literales `WorkspaceModeKind` y
  `EmbedderProvider`, eliminando la duplicación que podía derivar en
  el bug sigiloso "unión actualizada, array no" (o viceversa).
- **A1** se mantiene como nota documentada (aggregate root cohesivo
  por diseño DDD, no es violación de SRP).

Adicionalmente, las correcciones derivadas del ddd-validator
(unificación a campo abstracto `jsonRpcCode: number | null`, `import
type` en `invalid-mode-transition-error.ts`, eliminación del reexport
`JSON_RPC_CATALOG`, defensive copy del buffer `events`, rename
uniforme de factories `*Mode()`) están todas implementadas
correctamente, compilan limpio bajo el régimen estricto completo, y
no abren ninguna nueva sospecha de violación SOLID o de type-safety.

`tsc --strict` con los 18 flags exigidos por §1.6 termina con
**exit code 0**, cero errores y cero warnings sobre los 16 archivos
del scope (y los 14 transversales de `shared/domain`). La auditoría
grep confirma cero `any`, cero `// @ts-*`, y los únicos casts
presentes en `workspace/domain` son las dos `as const` introducidas
intencionalmente para resolver A3 (canónico, no inseguro). La
modularidad estricta sigue siendo absoluta: cero imports
cross-módulo en los 49 imports del módulo.

El módulo `workspace/domain` queda **listo para fase de
infraestructura**: los adapters
`infrastructure/persistence/json-file-workspace-repository.ts` y
`infrastructure/services/fs-workspace-detector.ts`, y los use cases
de application (`InitializeWorkspaceUseCase`, `UnlockWorkspaceUseCase`,
`ChangeModeUseCase`, `LockWorkspaceUseCase`) pueden construirse sobre
el contrato actual sin necesidad de revisitar el dominio.

---

## Próximo paso recomendado

1. **Liberar `domain-architect` para Tarea 3 de Fase 1** (puertos
   compartidos en `shared/application/ports/`: `Clock`, `IdGenerator`,
   `Logger`, `Database`, `Embedder`, `KDF`).
2. Cuando se introduzcan más uniones literales en otros módulos
   (`MemoryEntryKind`, `RetrievalLayer`, etc.), aplicar desde el
   primer commit el patrón `as const`-array → unión derivada que
   acabamos de consolidar aquí.
3. La Fase de QA debe agregar tests unitarios sobre invariantes
   específicas del agregado tras los cambios:
   - `rejectReinitialization()` siempre lanza
     `WorkspaceAlreadyInitializedError` con el id correcto y respeta
     la firma `never` (tests pueden hacer `expect(() =>
     ws.rejectReinitialization()).toThrow(...)` y verificar que el
     compilador acepta `() => ws.rejectReinitialization()` como
     `() => never`).
   - Defensive copy: mutar el array `events` pasado al constructor
     después de la construcción NO debe afectar a `pullEvents()` del
     agregado.
   - Factory rename: `WorkspaceMode.sharedMode().equals(WorkspaceMode.create("shared"))`
     etc., para confirmar paridad semántica con la creación general.
   - `EmbedderSpec` y `WorkspaceMode`: agregar un nuevo elemento a los
     arrays `as const` en una rama temporal y verificar que el
     compilador automáticamente exige actualizar los handlers
     (`isShared/isEncrypted/...`, `requiresKey()`) — debe ser una
     "explosión controlada" gracias a la unión exhaustiva derivada.
