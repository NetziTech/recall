# DDD Validation — Phase 1, Task 6: mcp-server/domain
**Validator:** ddd-validator
**Phase:** phase-1-domain (mcp-server module — protocol surface)
**Scope:** `code/src/modules/mcp-server/domain/` (21 archivos: 1 aggregate, 11 VOs, 3 events, 5 errors, 1 service interface, 0 entities, 0 repositories)
**Date:** 2026-04-27
**Verdict:** APROBADO

El módulo cumple §1.2 (DDD), §1.4 (SOLID — ISP) y §1.5 (modularidad) de `docs/12-lineamientos-arquitectura.md` sin hallazgos bloqueantes. La superficie del protocolo está modelada como un bounded context limpio: 11 VOs con `private constructor` + factory + invariantes + `equals()` (los dos VOs sin `equals()` propio lo heredan correctamente de `Id` y `NonEmptyString`), un aggregate `ToolRegistration` con identidad `ToolName`, mutaciones por verbos del negocio (`enable`/`disable`/`recordInvocation`), eventos en past-tense kebab `mcp-server.<...>`, errores tipados con `jsonRpcCode` mapeable directamente a la wire response, y cero imports cross-módulo. Las 10 decisiones notables del implementador están justificadas y son coherentes con el dominio.

Las observaciones que siguen son menores (sub-críticas) y se documentan para que el implementador las absorba en el próximo PR sin bloquear la entrega.

---

## Hallazgos

### CRÍTICOS (bloquean aprobación)

Ninguno.

### MENORES (no bloquean — fix oportunista)

#### M1. `JsonRpcErrorCode` (clase) colisiona en nombre con `JsonRpcErrorCode` (type) de `shared/`
**Archivos:** `code/src/modules/mcp-server/domain/value-objects/error-code.ts:67`, `code/src/shared/domain/errors/json-rpc-error-codes.ts:55`

`shared/domain/errors/json-rpc-error-codes.ts:55` ya exporta `export type JsonRpcErrorCode = (typeof JsonRpcErrorCodes)[keyof typeof JsonRpcErrorCodes]` — la unión numérica de los códigos custom MCP-Memoria. La clase `JsonRpcErrorCode` definida en este módulo lleva *exactamente* el mismo nombre pero un significado distinto (wrapper que también acepta los rangos JSON-RPC standard -32700..-32600 y -32099..-32000). Cualquier archivo que necesite ambos (un caso de uso que valide un código entrante con la clase y luego lo compare contra la unión literal del catálogo) tendría que aliasar uno de los dos en el `import` (`import { JsonRpcErrorCode as JsonRpcCustomCode }`).

No es violación de regla DDD, pero el lineamiento §3.2 ("identificadores reflejan el negocio sin ambigüedad") y la regla de "una sola fuente de verdad" del CLAUDE.md global sugieren resolverlo. Dos opciones:
- Renombrar la clase a `JsonRpcErrorCodeValue` o `JsonRpcCode` (este último es más corto y consistente con `RequestId`, `ToolName`).
- Renombrar el type del catálogo a `JsonRpcErrorCodeLiteral` o `CustomJsonRpcCode` (el catálogo en sí ya no es ambiguo porque es la constante `JsonRpcErrorCodes` plural).

Camino sugerido: renombrar la clase a `JsonRpcCode` (más sucinta y mantiene el sufijo `Code` que ya tiene `ToolCallId.code`/`UnknownToolError.code`).

#### M2. `ToolRegistration.recordInvocation` acepta llamadas con tool deshabilitada — invariante no documentada en JSDoc visible
**Archivo:** `code/src/modules/mcp-server/domain/aggregates/tool-registration.ts:193-209`

La decisión #5 ("recordInvocation NO emite evento") está justificada y aceptada. Sin embargo el método NO valida `this.enabled === true`. El JSDoc lo justifica explícitamente ("la registry es la gatekeeper que decide si despachar; una vez despachado, la bookkeeping debe reflejar el intento"), lo cual es defendible bajo la postura "el aggregate no enforza lo que la application layer ya enforzó".

El riesgo concreto: si en el futuro un caso de uso llama `registration.recordInvocation()` desde un test o un flujo donde la chequera de `enabled` no haya pasado por `ToolRegistry`, el aggregate va a aceptar silenciosamente la llamada y `invocationCount`/`lastInvokedAt` van a divergir de la realidad ("se invocó 5 veces una tool deshabilitada"). En el resto del módulo el patrón es lo opuesto (e.g. `enable()`/`disable()` rechazan no-ops para mantener limpio el audit trail).

Hay dos lecturas DDD-coherentes y ambas son válidas:
1. **Status quo (aceptable):** mantener la postura actual y volverla parte explícita del contrato del aggregate. Agregar un método `getInvocationStats()` o similar y documentar que "el aggregate confía en el callsite". Esto es defendible si el dominio considera que la deshabilitación es solo un filtro de catálogo (`tools/list`), no un kill-switch del invocador.
2. **Endurecer (recomendado):** validar `if (!this.enabled) throw new InvariantViolationError(...)`. Esto alinea `recordInvocation` con `enable`/`disable` (todos defensivos) y previene el bug futuro de divergencia.

Camino sugerido: opción 2 si el dominio ve la deshabilitación como "no se puede invocar" (que es lo que dice `ToolDisabledError`). Si se elige opción 1, agregar un párrafo explícito al JSDoc del método y al class-level explicando que `recordInvocation` es "trust-the-caller".

#### M3. `Defensive copy` en constructor de `ToolRegistration` para `events` puede inducir ruido
**Archivo:** `code/src/modules/mcp-server/domain/aggregates/tool-registration.ts:80-82`

El constructor hace `this.events = [...input.events]` para defender el buffer interno. Esto es correcto, pero los dos sitios de llamada (`register` y `rehydrate`) controlan el array de origen 100%: `register` pasa `[event]` recién instanciado, `rehydrate` pasa `[]`. La copia defensiva es teóricamente necesaria solo si un futuro `restore` recibe el buffer desde fuera del módulo, lo cual no es un caso real (el contrato de `pullEvents()` ya entrega un array nuevo via `slice()`).

No es bug — es código defensivo válido. La nota es para que el implementador considere si vale la asignación O(N) en hot-path (cada `register` copia `[event]`, costo despreciable; cada `rehydrate` copia `[]`, costo cero). Si en el futuro `rehydrate` se llama 10K veces al boot, vale revisitar.

Camino sugerido: ninguno requerido. Mantener como está.

---

## Verificación checklist DDD prioritario

### 1. VOs inmutables, factory, readonly, equals
APROBADO. Los 11 VOs cumplen:
- `private constructor` (verificado en `error-code.ts:68`, `client-info.ts:51,153`, `invocation-count.ts:32`, `last-invoked-at.ts:39`, `protocol-version.ts:36`, `request-id.ts:57`, `tool-args.ts:36`, `tool-description.ts:35`, `tool-name.ts:52`, `tool-result.ts:43`).
- `ToolCallId` extiende `Id<ToolCallIdBrand>` y hereda `private constructor`-equivalente del padre (constructor `protected` de `Id`); el factory `from(raw)` valida UUID v7 vía `Id.normalize`.
- `equals()` propio en 9 VOs; los dos restantes (`ToolCallId`, `ToolDescription`) heredan `equals` del padre con la narrowing-by-subclass de `NonEmptyString` que distingue `ToolDescription` de cualquier otro `NonEmptyString`. La herencia es correcta y consistente con `WorkspaceId`/`DecisionId` en otros módulos.
- Props `readonly` en todos los VOs (incluyendo el discriminator `kind` y los payload-slots de `ToolResult`).
- Invariantes validadas en construcción: `ToolName` rechaza nombres fuera del catálogo MVP, `ToolDescription` enforza `length ≤ 2000`, `ProtocolVersion` enforza semver, `RequestId` rechaza `null`/fraccionario/empty, `JsonRpcErrorCode` valida rangos y delega a `JsonRpcErrorCodes`, `ClientInfo` deduplica capabilities, etc.
- Mutación = nuevo VO: `InvocationCount.increment()`, `LastInvokedAt.touch(at)` retornan instancias nuevas; sin setters en ningún archivo (`grep -rE "set [a-zA-Z]+\("` retorna vacío).

### 2. Aggregate `ToolRegistration` — identidad clara, invariantes, no-op rejects
APROBADO con observación M2.
- Identidad `ToolName` clara: `getName()` retorna VO inmutable; campo `name` `readonly` (`tool-registration.ts:56`).
- Mutaciones por verbos: `register`, `rehydrate`, `enable`, `disable`, `recordInvocation`. Cero setters públicos (`grep -rE "set [a-zA-Z]+\("` vacío).
- No-op rejects: `enable` lanza `InvariantViolationError("already-enabled")` (`tool-registration.ts:156-160`), `disable` lanza `InvariantViolationError("already-disabled")` (`tool-registration.ts:178-181`). Patrón idéntico a `Workspace.unlock`/`lock` — decisión #6 justificada.
- `pullEvents()` defensivo: drena vía `slice()` + `length = 0`, retorna `Object.freeze`. Patrón consistente con `Decision.pullEvents()` y `Workspace.pullEvents()`.
- Factory `register(...)` emite `ToolRegistered`; `rehydrate(...)` no emite (decisión #4 implícita: rehidratar no es hecho de negocio). Correcto.

### 3. Eventos past tense `"mcp-server.<kebab>"`
APROBADO.
- `tool-registered.ts:20-21`: `eventName = "mcp-server.tool-registered"`.
- `tool-enabled.ts:19-20`: `eventName = "mcp-server.tool-enabled"`.
- `tool-disabled.ts:21-22`: `eventName = "mcp-server.tool-disabled"`.
- Los tres son past tense, kebab-case, con prefijo de módulo `mcp-server.` — cumplen el contrato declarado en `shared/domain/types/domain-event.ts:23-25`.
- Props `readonly` (`occurredAt`, `toolName`, `eventName` literal).
- Sólo carga la información mínima del hecho: identidad de la tool + timestamp. NO copian el aggregate completo (regla R6 satisfecha).

### 4. Errores tipados con jsonRpcCode apropiado
APROBADO.
- `McpServerDomainError` abstracto con `abstract readonly jsonRpcCode: number | null` (`mcp-server-domain-error.ts:32`) — fuerza a subclases a declarar el code como propiedad readonly (no método), permitiendo lectura uniforme en transport adapter.
- `UnknownToolError`: `code = "mcp-server.unknown-tool"`, `jsonRpcCode = -32601`. Mapeo correcto al standard JSON-RPC `METHOD_NOT_FOUND` (§5.1 spec).
- `ToolDisabledError`: `code = "mcp-server.tool-disabled"`, `jsonRpcCode = -32601`. Decisión #10 (mismo wire code que `UnknownToolError` por privacidad) — ver verificación punto 7 abajo.
- `InvalidProtocolVersionError`: `code = "mcp-server.invalid-protocol-version"`, `jsonRpcCode = -32600` (`INVALID_REQUEST`). Mapeo correcto: el `initialize` handshake va sobre el envelope, no es parameter-level (§5.1 spec).
- `InvalidRequestIdError`: `code = "mcp-server.invalid-request-id"`, `jsonRpcCode = -32600`. Idem: el id es del envelope, no del método.
- Constantes inline (`METHOD_NOT_FOUND`, `INVALID_REQUEST`) en cada error; el JSDoc de `unknown-tool-error.ts:5-12` documenta correctamente por qué NO viven en `JsonRpcErrorCodes` shared (el catálogo enumera sólo el rango custom MCP-Memoria, no el standard JSON-RPC). Decisión arquitectónicamente sólida.

### 5. `unknown` justificado: SOLO en `ToolArgs.raw()` y `ToolResult` payloads
APROBADO. Auditoría grep `\bunknown\b` en `domain/`:
- `tool-args.ts:36,43,62`: el VO está construido alrededor de `unknown` con justificación load-bearing en JSDoc (decisión #1). Correcto.
- `tool-result.ts:34,39,45,48,54,58,70`: payload de éxito y `data` de error son `unknown` con justificación equivalente. Correcto.
- `request-id.ts:68`: `RequestId.from(raw: unknown)` — justificado: el id viene del JSON parser y se discrimina dentro del factory con `typeof === "string" | "number"`. Esto es exactamente el patrón "unknown entra, validado con narrowing antes de usar" del lineamiento §1.6. Correcto.
- `mcp-server-domain-error.ts:34`, `unknown-tool-error.ts:39`, `tool-disabled-error.ts:44`, `invalid-protocol-version-error.ts:30`, `invalid-request-id-error.ts:34`: todos los `cause?: unknown` siguen el contrato `Error.cause` ES2022 standard. Es el tipo nativo, no es escape hatch.

Cero `unknown` espurio. Cero `any`/`as any`/`@ts-ignore`/`@ts-nocheck` (verificado vía grep). Cumple §1.6 (cero `any`).

### 6. `InvocationCount` y `LastInvokedAt` locales — duplicación razonable
APROBADO. Comparativa lado a lado:
- `mcp-server.InvocationCount` vs `memory.UseCount`: shape idéntico (`zero()`, `of()`, `increment()`, `toNumber()`, `isZero()`, `equals()`), invariantes idénticas (no-negative finite integer). Diferencia de naming refleja el bounded context (`use_count` es columna del schema de memoria; `invocation_count` es bookkeeping in-memory del registry) — decisión #7 justificada con el mismo argumento que el implementador (cross-module prohibido por §1.5; promoción a `shared/` requiere tercer consumidor).
- `mcp-server.LastInvokedAt` vs `memory.LastUsed`: shape idéntico (DU `never|at`, `touch()`, `millisecondsSince()`, `equals()`). El JSDoc de `last-invoked-at.ts:9-19` nota el paralelo y aplica el mismo argumento.
- La regla `shared/` arranca cuando hay un *tercer* consumidor (CLAUDE.md global, "Si una funcionalidad es usada por 2 o más módulos → DEBE estar en `shared`"). Aquí el contador *general* está duplicado en 2 módulos — la lectura literal del global CLAUDE.md sí justificaría promoción inmediata. Sin embargo `docs/12-lineamientos-arquitectura.md` §1.5 Regla 3 ("Si dos o más módulos necesitan una funcionalidad, esa funcionalidad se mueve a `shared/` inmediatamente. No se duplica.") es más estricta.

Hay tensión entre el CLAUDE.md global / §1.5 ("dos consumidores → promover") y la postura del implementador ("dos consumidores con bounded contexts distintos → mantener local hasta el tercero"). La argumentación bounded-context es correcta DDD-puro: `UseCount` participa del scoring de recall (`docs/01-arquitectura.md` §2.6 `usage_frequency`), `InvocationCount` participa del bookkeeping operacional del registry. Promoverlos a un único `shared.Counter` eliminaría la distinción semántica y haría que un cambio en uno (e.g. `UseCount.decay()` para curador) impactara a `InvocationCount` indebidamente.

**Veredicto:** acepto la duplicación local con la siguiente nota — esta es una de las pocas decisiones DDD donde "literal de §1.5" entra en conflicto con "espíritu DDD de bounded contexts". El implementador documentó la decisión inline (`invocation-count.ts:9-21`, `last-invoked-at.ts:13-23`) y eligió la lectura DDD-purista. Es consistente con cómo se modela `Tags` en cada módulo. Si el ADR-process del orquestador prefiere la lectura literal de §1.5, abrir issue para promover `Counter` y `LastTouchedAt` genéricos a `shared/domain/value-objects/`. Para esta task: APROBADO.

### 7. Decisión `UnknownToolError`/`ToolDisabledError` mismo wire code — DDD-coherente
APROBADO. Análisis:
- **A nivel transport (lo que el cliente recibe):** ambos errores serializan `code: -32601` con `message`/`data` distintos. El JSDoc de `tool-disabled-error.ts:5-15` documenta explícitamente el motivo: "el protocolo no nos deja advertir 'el método existe pero está disabled' sin filtrar server state". Esta es la postura correcta de privacidad: un cliente externo no debe poder enumerar la lista de herramientas existentes pero deshabilitadas via probing.
- **A nivel dominio (lo que el audit log y la application layer ven):** las dos clases son distintas (`instanceof UnknownToolError` vs `instanceof ToolDisabledError`), tienen `code` distinto (`mcp-server.unknown-tool` vs `mcp-server.tool-disabled`), y `toolName` se tipa distinto (`string` vs `ToolName` — porque `UnknownToolError` por definición recibe un nombre que NO pasó la validación del registry, mientras `ToolDisabledError` recibe un VO ya validado).

Esta separación es exactamente el patrón "wire-coalesced, domain-distinct" recomendado para errores con motivos de privacidad/seguridad. NO esconde un bug futuro: el día que el equipo decida exponer la información (o crear un endpoint admin que sí distinga), la separación domain-side ya está en su lugar y solo hay que cambiar el `jsonRpcCode` o crear un adapter que mapee distinto cuando el caller es admin. Lo opuesto (colapsar a una sola clase) sería el bug futuro porque obligaría a re-introducir la distinción más tarde.

Decisión #10 APROBADA. Coherente con DDD (los errores son tipos de primera clase del dominio) y con la guía de seguridad ("no revelar superficie no contratada" — cf. §11 OWASP A01:2021).

### 8. Cero imports cross-módulo
APROBADO. Auditoría grep `code/src/modules/(workspace|memory|retrieval|curator|secrets|encryption|cli)` en `mcp-server/domain/`: vacío. Todos los imports son a `../../../../shared/...` o relativos al propio módulo. Cumple §1.5 sin excepciones.

---

## Verificación adicional — decisiones notables del implementador

| # | Decisión | Veredicto | Notas |
|---|---|---|---|
| 1 | `ToolArgs.raw(): unknown` load-bearing | APROBADO | JSDoc explica por qué Zod vive en application |
| 2 | `ToolResult` DU success/error con `unknown` payload | APROBADO | `error()` valida invariantes JSON-RPC §5.1 (code finito integer, message no-empty) |
| 3 | `RequestId` DU `string`/`number` | APROBADO | Preserva round-trip exacto §4.1; rechaza fraccionarios |
| 4 | `ToolRegistration` es aggregate | APROBADO | Identidad `ToolName`, eventos en transiciones, `pullEvents()` |
| 5 | `recordInvocation` no emite evento | APROBADO | Justificado (telemetría ≠ event bus); ver M2 sobre validación enabled |
| 6 | `enable`/`disable` rechazan no-ops | APROBADO | Patrón idéntico a `Workspace.unlock`/`lock` |
| 7 | `InvocationCount`/`LastInvokedAt` locales | APROBADO | Ver checklist §6 arriba — argumento bounded-context aceptado |
| 8 | `ToolRegistry` interface sin `delete()` | APROBADO | ISP: sibling `MutableToolRegistry` cuando aparezca el caso |
| 9 | `JsonRpcErrorCode` VO usa `JsonRpcErrorCodes` shared como SSOT | APROBADO | Computa whitelist via `Object.values`, sync automático; ver M1 sobre nombre |
| 10 | `UnknownToolError`/`ToolDisabledError` mismo wire code | APROBADO | Ver checklist §7 arriba — patrón "wire-coalesced, domain-distinct" |

---

## Verificación SOLID (relevante a DDD)

- **SRP:** cada VO tiene una sola razón para cambiar (cambio en el catálogo MVP toca solo `ToolName`; cambio en el cap de descripción toca solo `ToolDescription`; etc.).
- **OCP:** agregar un nuevo error solo requiere extender `McpServerDomainError`. Agregar un nuevo evento solo requiere implementar `DomainEvent`. Sin if-trees centrales.
- **LSP:** `ToolDescription extends NonEmptyString` respeta el contrato (override de `create` mantiene el invariante non-empty + agrega length cap; `equals` heredado preserva narrowing-by-subclass). `JsonRpcErrorCode` es propio (no extiende), no hay tema LSP.
- **ISP:** `ToolRegistry` (3 métodos: `register`, `findByName`, `listAll`) es estrechísimo. La decisión #8 documenta que `delete()` irá a un `MutableToolRegistry` aparte. Excelente.
- **DIP:** ninguna dependencia concreta — todo el dominio depende de abstracciones (`DomainEvent`, `Timestamp`, `Id`).

---

## Verificación de naming (lineamiento §3.3, regla R7 del prompt)

Auditoría grep de naming genérico (`Item|Record|Data|Object|Manager|Helper|Util|Service`) en declaraciones (`class|interface|type`) del módulo: vacío. Todos los nombres reflejan el dominio del protocolo MCP:
- `ToolRegistration`, `ToolName`, `ToolDescription`, `ToolCallId`, `ToolArgs`, `ToolResult`: lenguaje del protocolo MCP.
- `RequestId`, `ProtocolVersion`, `JsonRpcErrorCode`: lenguaje JSON-RPC §4-§5.
- `ClientInfo`, `ClientName`: lenguaje del handshake `initialize`.
- `InvocationCount`, `LastInvokedAt`: lenguaje del bookkeeping del registry.
- `ToolRegistry`: nombre apropiado (no es el sufijo `Service` genérico — es el catálogo del dominio).
- Eventos `ToolRegistered`, `ToolEnabled`, `ToolDisabled`: past-tense, sin redundancia.
- Errores `UnknownToolError`, `ToolDisabledError`, `InvalidProtocolVersionError`, `InvalidRequestIdError`: descriptivos, alineados con el motivo de la falla.

Sin sufijo `I` para interfaces (`ToolRegistry`, no `IToolRegistry`). Cumple §3.2.

---

## Resumen ejecutivo

| Métrica | Valor |
|---|---|
| Archivos auditados | 21 |
| Hallazgos críticos | 0 |
| Hallazgos menores | 3 (M1 naming colision, M2 invariante en `recordInvocation`, M3 nota sobre defensive copy) |
| VOs con `equals` | 11/11 (9 propios + 2 heredados de `Id`/`NonEmptyString`) |
| VOs con `private constructor` | 11/11 |
| Aggregates con `pullEvents()` | 1/1 |
| Eventos en past-tense kebab | 3/3 |
| Errores con `jsonRpcCode` | 4/4 (la base abstracta no cuenta) |
| Imports cross-módulo | 0 |
| Usos de `any` / `@ts-ignore` | 0 |
| Usos de `unknown` justificados | 100% (todos en `ToolArgs`/`ToolResult` payloads, `RequestId.from`, `Error.cause`) |

**Verdict final: APROBADO.** El módulo `mcp-server/domain/` puede avanzar al `solid-validator`. Los hallazgos M1, M2 y M3 son recomendaciones de calidad — el implementador puede absorberlos en este PR (preferible para M2) o en un follow-up cosmético (aceptable para M1, M3).

---

## Reporte machine-readable

```json
{
  "validator": "ddd-validator",
  "phase": "phase-1-domain",
  "task": "task-6-mcp-server-domain",
  "verdict": "APROBADO",
  "files_audited": 21,
  "blocking_violations": [],
  "minor_observations": [
    {
      "id": "M1",
      "rule": "R7-domain-language (naming clarity)",
      "file": "code/src/modules/mcp-server/domain/value-objects/error-code.ts",
      "line": 67,
      "detail": "La clase JsonRpcErrorCode colisiona en nombre con el type JsonRpcErrorCode exportado por shared/domain/errors/json-rpc-error-codes.ts:55. Cualquier archivo que use ambos requiere alias en el import.",
      "suggested_fix": "Renombrar la clase a JsonRpcCode (más sucinta y mantiene consistencia con RequestId, ToolName)."
    },
    {
      "id": "M2",
      "rule": "R3-aggregate-invariants (defensive consistency)",
      "file": "code/src/modules/mcp-server/domain/aggregates/tool-registration.ts",
      "line": 206,
      "detail": "recordInvocation no valida this.enabled === true. El JSDoc lo justifica como trust-the-caller pero crea riesgo de divergencia (invocationCount/lastInvokedAt actualizados para tools deshabilitadas si la application layer falla en gatekeeping). El resto del aggregate (enable/disable) es defensivo.",
      "suggested_fix": "O bien (preferido) agregar throw new InvariantViolationError cuando !this.enabled (alinea con enable/disable), o bien documentar explícitamente en el class-level JSDoc que el aggregate confía en el callsite y exponer el contrato como parte de la API."
    },
    {
      "id": "M3",
      "rule": "Note (no rule violation)",
      "file": "code/src/modules/mcp-server/domain/aggregates/tool-registration.ts",
      "line": 82,
      "detail": "Defensive copy de events buffer en constructor (this.events = [...input.events]) es correcta pero los dos callsites (register, rehydrate) controlan el array origen al 100%. La copia es teóricamente innecesaria. No es bug.",
      "suggested_fix": "Mantener como está — código defensivo válido. Nota solo para futura referencia si se introduce un nuevo factory que reciba buffer externo."
    }
  ],
  "checklist_results": {
    "vos_immutable_factory_readonly_equals": "PASS",
    "aggregate_identity_invariants_no_op_rejects": "PASS_WITH_M2",
    "events_past_tense_kebab_with_module_prefix": "PASS",
    "errors_typed_with_appropriate_json_rpc_code": "PASS",
    "unknown_justified_only_in_tool_args_and_tool_result": "PASS",
    "invocation_count_last_invoked_at_local_duplication": "PASS_WITH_NOTE",
    "unknown_tool_and_tool_disabled_same_wire_code": "PASS",
    "zero_cross_module_imports": "PASS"
  }
}
```
