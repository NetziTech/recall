# DDD Validation — Phase 1, Task 4: secrets/domain
**Validator:** ddd-validator
**Phase:** phase-1-domain (secrets module — capa 1/2/5 de defensa documentada en `docs/11-seguridad-modos.md` §6)
**Scope:** `code/src/modules/secrets/domain/` (24 archivos: 1 aggregate, 12 value-objects, 1 repository, 3 services/ports, 4 events, 4 errors)
**Date:** 2026-04-27
**Verdict:** APROBADO

Resumen ejecutivo — el módulo entrega un dominio coherente, defensivo y bien justificado para las cinco capas de defensa documentadas. Los 12 VOs tienen `private constructor` + factory + invariantes en el factory + props `readonly` + `equals`. El único aggregate (`SecretAuditEntry`) custodia identidad inmutable, expone factories `record()`/`rehydrate()` separados, emite exactamente un evento `SecretAuditEntryRecorded` y drena con `pullEvents()` defensivo. La interfaz `SecretAuditRepository` trabaja con el aggregate completo y respeta la naturaleza append-only del audit (sin update/delete). Los 4 eventos son past-tense kebab con prefijo `secrets.<kebab>` y carry-by-id (no copia entera del aggregate). Los 4 errores extienden `SecretsDomainError` → `DomainError` con `code` estable + `jsonRpcCode` opcional. Cero imports cross-módulo, cero imports a `application/`/`infrastructure/`/`node:`, cero `any`/`@ts-ignore`/`console.*`/`process.*`. Las 10 decisiones notables del implementador están bien argumentadas en JSDoc y son defendibles.

Las observaciones que siguen son **advertencias estilísticas y sugerencias de robustez**, no bloquean aprobación.

---

## Hallazgos

### CRÍTICOS (bloquean aprobación)

Ninguno.

---

### ADVERTENCIAS (no bloquean, considerar antes de cerrar fase)

#### A1. `SecretsScanner`, `PatternRegistry`, `EntropyCalculator` viven en `domain/services/` aunque son driven ports
**Archivos:**
- `code/src/modules/secrets/domain/services/secrets-scanner.ts:49-52`
- `code/src/modules/secrets/domain/services/pattern-registry.ts:29-32`
- `code/src/modules/secrets/domain/services/entropy-calculator.ts:31-33`

`docs/12-lineamientos-arquitectura.md` §1.3 define los driven ports como interfaces que viven en `domain/repositories/` o `application/ports/out/`. Lo que vive en `domain/services/` debe ser **lógica de dominio que cruza varios agregados** (R5 del checklist). Las tres interfaces actuales son puramente puertos de salida — abstracciones de infraestructura (regex, math, cache de patrones). El JSDoc de cada una se autodescribe como "Driven port (output port)".

Sin embargo, **existe un precedente aprobado** en el módulo `workspace`: `WorkspaceDetector` está en `workspace/domain/services/` y la Tarea 2 lo aprobó (`phase-1-task-2-ddd-validator-cycle-1.md` — APROBADO). La inconsistencia es entonces estructural en la convención del proyecto, no específica de secrets. Mantengo la advertencia para que el orquestador decida:
- (a) Aceptar el precedente de workspace y dejar los tres puertos donde están (consistencia interna).
- (b) Mover los tres puertos (más `WorkspaceDetector`) a `application/ports/out/` cuando se construya la capa application en Fase 2 (consistencia con el lineamiento literal).

Mi recomendación: opción (b), pero como cambio de Fase 2 — el dominio de secrets queda igual hasta que workspace y secrets migren a la vez. No bloquea Tarea 4.

#### A2. `SecretMatch.length` es un campo derivado almacenado, no calculado
**Archivo:** `code/src/modules/secrets/domain/value-objects/secret-match.ts:48-53,112-113`

El factory acepta `{start, end, evidence}` y deriva `length = end - start`. El campo se almacena como `public readonly length: number`. El JSDoc justifica la duplicación ("para que los invariantes se puedan expresar localmente"), pero:

- El invariante `length === end - start` es estructuralmente garantizado por el factory (línea 112), entonces **no hay manera de construir un `SecretMatch` con length inconsistente**. El campo derivado solo añade superficie a mantener.
- `equals()` compara `length` además de `start`/`end` (líneas 119-121), lo cual es redundante: si `start === other.start && end === other.end`, entonces `length === other.length` necesariamente. La comparación extra es defensiva pero ruido.

**Acción sugerida:** o bien eliminar `length` y exponer un getter `getLength(): number` que devuelve `this.end - this.start`, o bien mantener el campo y eliminar la comparación redundante en `equals` (el invariante del factory garantiza la consistencia). Coste bajo, beneficio: una propiedad menos en el surface público.

#### A3. `SecretFinding` no expone `equals` por composición de aggregate VO
**Archivo:** `code/src/modules/secrets/domain/value-objects/secret-finding.ts:76-84`

`SecretFinding.equals` itera 5 campos a mano, lo cual está bien. Pero un detalle: el método ordena las comparaciones por costo (kind primero, luego position, etc.) — sin embargo `confidence.equals` y `SecretSources.equals` se llaman incondicionalmente aunque `kind` ya sea distinto. Esto es correcto (cortocircuito por `if (...) return false` en cada paso), pero el patrón es inconsistente con el resto del proyecto que usa `&&` chain (ver `secret-match.ts:118-123`). Estilístico; no afecta corrección.

**Acción sugerida:** opcional — uniformar al patrón `&& chain` para legibilidad.

#### A4. `SanitizedText.create` no valida la consistencia de offsets entre `findings` y `sanitized`
**Archivo:** `code/src/modules/secrets/domain/value-objects/sanitized-text.ts:49-75`

El invariante cross-field validado es: `findings.length === 0 ⇒ sanitized === original`. **Falta** validar el caso simétrico: cuando `findings.length > 0`, los offsets `start`/`end` de cada `SecretMatch` deberían apuntar a posiciones legales dentro de `original` (i.e., `match.end <= original.length`). Si un adapter mal implementado pasa un `SecretFinding` con `position.end = 9999` sobre un `original.length = 50`, el VO actual lo acepta sin chistar.

Es una invariante de defensa-en-profundidad: el factory ya confía en que cada VO componente está bien construido, así que esto no es bloqueante. Pero el JSDoc declara que `SanitizedText` "guarantees the snippet is well-formed and bounded" — esa promesa quedaría más sólida con el check.

**Acción sugerida:** agregar un loop por `input.findings` validando `match.position.end <= input.original.length` y rechazando con `InvalidInputError` si no se cumple. Ocho líneas de código, cierra el último gap de invariantes compositivos.

#### A5. `SecretSources` y `SecretActions` namespace pattern vs class pattern
**Archivos:**
- `code/src/modules/secrets/domain/value-objects/secret-source.ts:63-165`
- `code/src/modules/secrets/domain/value-objects/secret-action.ts:49-107`

Ambos son **discriminated unions sin clase wrapper**, expuestos como `type SecretSource = ... | ... | ...` + namespace de factories `SecretSources` / `SecretActions`. El resto del proyecto usa este mismo patrón para DUs más simples (`LastUsed`, `Scope` en memory module — confirmado y aprobado en Tarea 3). Acepto el patrón.

**Pequeña observación:** `SecretSources.equals` (líneas 147-164) tiene un `default: { const exhaustive: never = left; return exhaustive; }` que devolverá un valor en runtime si la DU se amplía. El compilador atrapa el error pero el branch igual se ejecuta. Sería más sólido `throw new Error(\`unreachable: ...\`)`. Mismo comentario para `PathSanitizerError.buildMessage:111-117` que retorna un string en lugar de throw. Estilístico.

**Acción sugerida:** opcional — convertir los `default: never` a `throw` para que el efecto runtime en caso de violación sea explícito.

#### A6. `SecretPattern.equals` por nombre vs `SecretMatch.equals` por valor — convención mixta intencional pero merece un párrafo de doc
**Archivo:** `code/src/modules/secrets/domain/value-objects/secret-pattern.ts:64-66,169-172`

El JSDoc explica que `SecretPattern.equals` compara solo por `name` (el "natural key" del registry). La justificación es buena: dos patrones con el mismo source pero distinto name son entradas separadas del registry. Sin embargo, esto rompe la regla R2 ("igualdad por valor", no por id) en el sentido estricto del lineamiento. La convención mixta es defendible pero genera una duda razonable en lectura: ¿qué significa "valor" para un VO compositivo?

El comentario en líneas 60-66 cubre esto, pero conviene reforzar que **el `SecretPattern` es un caso especial: tiene una identidad lógica natural (`DetectorName`) que le da semántica de "registry entry"**, similar a un VO con identidad por uno de sus campos. No es un agregado (no emite eventos, no tiene factory `record()`/`rehydrate()`) pero tampoco es un VO puro.

**Acción sugerida:** opcional — añadir una línea al JSDoc reconociendo la naturaleza mixta del VO. Alternativa: convertirlo en una `Entity` DDD (en `domain/entities/`), que sería estrictamente más correcto pero genera fricción con el resto del módulo. Mantener como VO con la justificación actual es aceptable.

#### A7. `AuditEventId` UUID v7 vs schema INTEGER AUTOINCREMENT — decisión bien argumentada pero el adapter queda con deuda
**Archivo:** `code/src/modules/secrets/domain/value-objects/audit-event-id.ts:11-35`

La decisión #3 del implementador (UUID v7 en dominio, INTEGER en schema) está bien argumentada en el JSDoc del VO. Acepto la decisión: consistencia con el resto de aggregates + sortabilidad nativa por tiempo. Pero el JSDoc dice "the persistence adapter is responsible for projecting this id onto whatever shape the `audit_log` schema requires" sin especificar la estrategia de mapeo. Concretamente:

- Si el adapter inserta el UUID v7 como string en `args_summary` (la única columna TEXT del schema actual `docs/03-modelo-datos.md` §4.8), pierde indexabilidad.
- Si el adapter agrega una columna `event_uuid TEXT UNIQUE` en una migración, hay un cambio de schema pendiente sin ADR.
- Si el adapter ignora el UUID v7 y deja que SQLite genere el INTEGER, hay un round-trip donde `domainId !== persistedId`, rompiendo la promesa de identity.

**Acción sugerida:** abrir ADR (puede vivir como nota en `docs/03-modelo-datos.md` §4.8) que documente cuál de las tres estrategias se sigue, antes de Fase 2 (infrastructure). Sin esto, el implementador del adapter tomará la decisión solo y el dominio quedará desalineado del schema persistido. Misma observación que A4 de la Tarea 3 sobre `RelationEndpoint`.

#### A8. `SecretAuditEntry.workspaceId` ausente del schema actual — proyectado vía `args_summary`
**Archivo:** `code/src/modules/secrets/domain/aggregates/secret-audit-entry.ts:38-45`

El JSDoc reconoce explícitamente que `audit_log` no tiene columna `workspace_id` y que el adapter proyecta el campo en `args_summary` (JSON blob). Es una decisión razonable a corto plazo, pero arrastra los mismos problemas que A7:

- Filtrar/ordenar por workspace requiere `JSON_EXTRACT(args_summary, '$.workspace_id')` en cada query — sin índice posible salvo expression-index, no estándar en SQLite.
- `findByWorkspace` (`secret-audit-repository.ts:59-62`) será O(n) sobre toda la tabla si no se agrega índice.

La intención del lineamiento es que la rolling 90-day retention mantenga el dataset chico (`docs/11-seguridad-modos.md` §6), y `findByWorkspace` solo devuelve los `limit` más recientes, así que el costo es acotado. Pero el contrato del repositorio promete eficiencia que el schema actual no facilita.

**Acción sugerida:** abrir ADR junto con A7 para decidir si se agrega `workspace_id TEXT` (con índice compuesto `(workspace_id, timestamp_ms DESC)`) en la migración 002 antes de cerrar Fase 1, o si se acepta el escaneo lineal con la promesa de retention.

#### A9. `PathSanitizerRule.apply` aplica `MAX_RAW_PATH_LENGTH` post-trim, no pre-trim
**Archivo:** `code/src/modules/secrets/domain/value-objects/path-sanitizer-rule.ts:154-169`

`trimmed = rawPath.trim()` ocurre antes del check de longitud (línea 160). Si el adversario manda 8 KiB de espacios + un path corto, pasa el check. Hoy es benigno (no hay ejecución downstream que dependa del raw length pre-trim), pero el nombre `MAX_RAW_PATH_LENGTH` sugiere que se chequea el raw, no el trimmed. Inconsistencia de naming.

**Acción sugerida:** o bien renombrar a `MAX_TRIMMED_PATH_LENGTH`, o bien mover el check antes del trim. Decisión menor.

#### A10. `EntropyThreshold.isHighEntropy` mezcla policy y execution (R5 borderline)
**Archivo:** `code/src/modules/secrets/domain/value-objects/entropy-threshold.ts:108-124`

El método recibe `text` y `entropyBitsPerChar` (computado externamente), aplica reglas (`text.length >= 20 && entropy > threshold`). El VO no es puro "configuración" — es policy + execution. Dado que el cálculo lo hace otro componente (`EntropyCalculator`), esto es aceptable: el VO solo aplica el umbral al resultado.

Pero el VO podría ser una **policy class** explícita (como `EntropyDetectionPolicy`), separada del simple `EntropyThreshold` que es solo un `bitsPerChar: number` validado. Hoy están fundidos.

**Acción sugerida:** opcional — separar `EntropyDetectionPolicy(threshold: EntropyThreshold, minLength: number)` con el método `isHighEntropy`, y dejar `EntropyThreshold` como VO puramente del valor. No bloquea: la fusión actual es defendible y consistente con cómo `SecretKind.isHardReject()` también mezcla "valor" con "policy".

---

### POSITIVOS (lo que el implementador hizo bien — no necesita cambios)

#### P1. VOs: 12/12 cumplen R2 estrictamente
- Constructor `private` (o `protected` heredado de `Id`/`NonEmptyString`).
- Factory `static` con nombre del negocio (`create`, `from`, `of`, `apiKey`, `defaultThreshold`, `clean`, `relativeOnly`, `tildeRewrite`, `text`, `filePath`, `logLine`, `blocked`, `redacted`, `warnedUser`, `record`).
- Invariantes validadas en factory (no en constructor — patrón shared/`NonEmptyString`).
- Props `readonly` (verificado: cero `private X:` ni `public X:` sin `readonly` en `value-objects/` ni `aggregates/`).
- `equals(other)` propio o heredado uniformemente.
- Cero strings/numbers crudos donde hay significado de negocio (`SecretKind` enum, `EntropyThreshold` ranged, `AuditEventId` branded UUID v7, `DetectorName` regex-validated).

#### P2. Aggregate `SecretAuditEntry`: factory `record()` vs `rehydrate()` separado
Misma disciplina que los aggregates de memory/workspace (decisión #5 de Tarea 3, P5 de Tarea 3 ddd validation). `record()` emite `SecretAuditEntryRecorded`; `rehydrate()` no emite. Resuelve estructuralmente la trampa "rehidratar genera eventos espurios al replay".

#### P3. Aggregate: append-only enforcement estructural
Cero métodos de mutación pública. Cero `update*`/`change*`/`mark*`. Solo getters + `pullEvents()`. Una vez construido vía `record()` o `rehydrate()`, el aggregate es un value object pesado de facto. Cumple la promesa de `docs/11-seguridad-modos.md` §6 ("Capa 5 — Auditoria on-demand", audit trail tamper-evident) en el dominio (la tamper-evidence transport-level la dará el adapter, ej. con HMAC).

#### P4. Repository `SecretAuditRepository` sin update/delete + métodos del negocio
- `findById`, `save`, `findByWorkspace(workspaceId, limit)`. Cero `findBy(predicate)`. Cero `delete`. Cumple R4 + la promesa append-only.
- JSDoc en el repo declara explícitamente "There are NO `update` or `delete` methods on this interface — adding them would betray the audit-trail promise". La convención está documentada en el contrato.

#### P5. Eventos: 4/4 cumplen R6
- Todos `implements DomainEvent`.
- `eventName: "secrets.<kebab>"` literal: `secrets.detected`, `secrets.redacted`, `secrets.blocked`, `secrets.audit-entry-recorded`. Convención `<module>.<past-tense-kebab>` per `domain-event.ts`.
- Todos los campos `readonly`.
- Cero copia entera del aggregate en payload — solo IDs + `SecretFinding` VO + `SecretAction` (datos del hecho).
- 3 eventos de outcome (`detected`/`redacted`/`blocked`) + 1 de persistencia (`audit-entry-recorded`) — la separación está bien argumentada en el JSDoc de `SecretAuditEntryRecorded`.

#### P6. Errores: 4/4 cumplen R5
- `SecretsDomainError` abstract base + 3 concretos (`PathSanitizerError`, `SecretDetectionFailedError`, `InvalidPatternError`).
- Cada uno con `code: "secrets.<error-name>"` estable + `jsonRpcCode: number | null` (mismo patrón de `WorkspaceDomainError` y `MemoryDomainError`).
- `PathSanitizerError` usa DU con 4 kinds (`path-traversal`, `absolute-path-not-allowed`, `invalid-separator`, `empty-path`), buildMessage exhaustivo por switch, type guard `isKind`. Correctamente Result-channel (usado vía `Result<SanitizedPath, PathSanitizerError>` en `PathSanitizerRule.apply` y en `SecretsScanner.scanPath`).
- `InvalidPatternError` deliberadamente NO carry el regex source (riesgo de leak de material parcial de secret en logs) — decisión de seguridad explícita en JSDoc.
- `SecretDetectionFailedError` distingue claramente "scanner crashed" de "scanner found a secret" (que es success path) — distinción doc'd para los operadores.

#### P7. Imports: cero cross-module, cero capa equivocada, cero `node:`
- Cero hits a `modules/(workspace|memory|retrieval|curator|encryption|mcp-server|cli)`.
- Cero hits a `application/`/`infrastructure/` en imports (las menciones son JSDoc).
- Cero `node:` imports.
- Solo imports relativos a `shared/domain/` (`InvalidInputError`, `Id`, `NonEmptyString`, `Confidence`, `Timestamp`, `WorkspaceId`, `Result`, `DomainEvent`, `DomainError`) o a archivos del propio módulo. R Modularidad estrictamente cumplido.

#### P8. Lenguaje del dominio
`SecretKind`, `DetectorName`, `SecretMatch`, `SecretPattern`, `EntropyThreshold`, `SecretSource`, `SanitizedPath`, `PathSanitizerRule`, `SanitizedText`, `SecretFinding`, `SecretAction`, `AuditEventId`, `SecretAuditEntry`, `SecretAuditRepository`, `SecretsScanner`, `PatternRegistry`, `EntropyCalculator`, `SecretDetected`, `SecretRedacted`, `SecretBlocked`, `SecretAuditEntryRecorded`, `PathSanitizerError`, `SecretDetectionFailedError`, `InvalidPatternError`, `SecretsDomainError` — todos términos del negocio según `docs/11-seguridad-modos.md` §6. Cero `Item`, `Record` (genérico), `Data`, `Manager`, `Helper`, `Util`, `Service` genérico, `Handler` genérico. Cero prefijos `I`. R7 cumplido.

#### P9. Decisión #1 (`SecretAction` extraído del aggregate) — refactor correcto que evita ciclo
La decisión #1 del implementador (mover `SecretAction` del aggregate a su propio archivo VO para evitar `secret-audit-entry-recorded.ts → secret-audit-entry.ts → secret-audit-entry-recorded.ts`) es estructuralmente necesaria. El evento ya importa `SecretAction` desde el VO (línea 5 de `secret-audit-entry-recorded.ts`), no desde el aggregate. Cero ciclo de imports.

#### P10. Decisión #5 (`SecretPattern.matches` redacta automáticamente)
La decisión de envolver `captured` en `[REDACTED:<length>]` dentro del propio VO (`secret-pattern.ts:184-186`) es defensa estructural: el `RegExp` compilado es `private`, `matches()` es la única forma de obtener resultados, y los resultados ya vienen redactados. **Es estructuralmente imposible que un consumidor lea el secret raw** desde el VO. Esta decisión vale más que mil tests: el invariante "evidence ≠ secret" lo custodia el lenguaje, no la disciplina. Excelente.

#### P11. Decisión #6 (invariantes `SecretMatch` `start ≥ 0`, `end > start`, `length === end - start`)
Las tres invariantes están enforced en el factory (líneas 75-95, 112-113). Adicional: `length > 0` se garantiza por `end > start` + `length = end - start`. La validación incluye `Number.isFinite` + `Number.isInteger` (defensa anti-`NaN`/`Infinity`/`1.5`). Robusto.

#### P12. Decisión #7 (`SanitizedText` cross-field invariant)
La invariante `findings.length === 0 ⇒ sanitized === original` (`sanitized-text.ts:64-69`) elimina el bug "sanitized derivado independientemente del findings empty case". Cumple R2 + cross-field check. Ver A4 para el simétrico que falta.

#### P13. Decisión #8 (`PathSanitizerRule.apply` retorna `Result`)
Correctamente Result-channel: rejection es expected outcome (caller branches on `kind` exhaustivamente), no exception. Consistente con `docs/12-lineamientos-arquitectura.md` §1.6: "Resultado de operaciones que pueden fallar: `Result<T, E>` o excepciones tipadas. Nunca `T | null` ambiguo". Acepto.

#### P14. Decisión #9 (cap 256 matches/scan en `SecretPattern.matches`)
El `MAX_MATCHES_PER_SCAN = 256` (`secret-pattern.ts:30`) protege contra DOS por regex laxo + audit-log inflation. La política está localizada en el VO + documentada en JSDoc. Cumple defense-in-depth de §6 sin filtrarse al adapter.

#### P15. Decisión #10 (3 eventos de outcome + 1 de persistencia)
La separación entre eventos de **outcome** (`detected`/`redacted`/`blocked` — el qué pasó con el finding) y **persistencia** (`audit-entry-recorded` — el qué pasó con la fila) es semánticamente correcta. Subscribers que les importa el outcome escuchan los tres primeros; subscribers que les importa el audit trail (SIEM, telemetría) escuchan el cuarto. JSDoc en `secret-audit-entry-recorded.ts:22-35` explica el modelo claramente.

#### P16. `Object.freeze` defensivo en arrays públicos
- `SecretPattern.matches` retorna `Object.freeze(collected)` (línea 166).
- `SanitizedText.create` hace `Object.freeze(input.findings.slice())` (línea 73).
- `SecretAuditEntry.pullEvents` retorna `Object.freeze([])` o `Object.freeze(drained)` (líneas 156, 159).
- `SecretSources.text/filePath/logLine` retornan `Object.freeze({...})` (líneas 82, 108, 128).
- `SecretActions.blocked/redacted/warnedUser` retornan `Object.freeze({...})` (líneas 51, 55, 59).

Defense-in-depth contra mutación accidental por consumers. Patrón consistente.

#### P17. `SanitizedPath.containsTraversalSegment` defensa-en-profundidad
El factory rechaza `..` aunque el sanitiser ya debería haberlo filtrado (líneas 74-79). JSDoc lo nombra explícitamente "second line of defence". Excelente: si el sanitiser tiene un bug, el VO no acepta el bypass.

#### P18. `PathSanitizerRule.tildeRewrite` corner cases robustos
- `userSegment.trim().length === 0` → fallback a `null` (no rewrite, no leak de `/Users//foo`).
- `userSegment` con separadores o NUL → fallback a `null` (defensa anti-injection).
- `null` userSegment → rewrite es no-op (la regla todavía aplica los otros checks).

Cubre los corner cases razonables sin sobreexponer.

#### P19. Constructor visibility
- 12/12 VOs: `private constructor` (concreto) o heredado `protected` (`AuditEventId`/`DetectorName` extienden `Id`/`NonEmptyString`).
- 1/1 aggregate: `private constructor`.
- 4/4 events: `public constructor` — aceptable porque los events son data-carriers inmutables construidos por el aggregate o por el use case con datos ya validados (mismo patrón que memory module).
- 4/4 errors: `public constructor` con input validado por la abstracción base. Estándar.

#### P20. Cero `any`, cero `@ts-ignore`, cero `console.*`, cero `process.*`, cero `require(`
Tipado total cumplido sin escapes. `unknown` se usa solo en `cause` de errores (intencional). Todos los `Number.isFinite`/`Number.isInteger` están donde se aceptan números externos.

---

## Verificación contra el checklist obligatorio

| # | Check | Verdict | Notas |
|---|---|---|---|
| 1 | VOs inmutables, validan en factory, readonly props, equals, constructor privado | OK | 12/12 |
| 2 | Aggregate: identidad, custodia invariantes, métodos del negocio, eventos, `pullEvents()`, `rehydrate()` no emite | OK | 1/1 (append-only ⇒ no methods de mutación; `record()` emite, `rehydrate()` no) |
| 3 | Eventos past-tense kebab con prefijo `secrets.<kebab>`, inmutables, `eventName` literal | OK | 4/4 |
| 4 | Repository trabaja con aggregate completo, queries con nombres de negocio, sin update/delete (append-only) | OK | 1/1, sin update/delete |
| 5 | Errores tipados, extienden `SecretsDomainError`/`DomainError`, código JSON-RPC apropiado | OK | 4/4 (3 concretos + 1 abstract base) |
| 6 | Lenguaje del dominio | OK | Todos los nombres alineados con `docs/11-seguridad-modos.md` §6 |
| 7 | Coherencia con docs/11 §6 (5 capas de defensa) | OK | Capa 1 (`SecretsScanner.scan` + `SecretPattern.matches`), Capa 2 (`SecretsScanner.scanPath` + `PathSanitizerRule`), Capa 5 (`SecretAuditEntry` + `SecretAuditRepository`) cubiertas. Capa 3 (encrypted) y Capa 4 (pre-commit hook) son responsabilidad de los módulos `encryption` y `cli`/`infrastructure`, no de `secrets/domain` |
| 8 | Imports sólo desde `shared/domain/` con paths relativos | OK | Cero cross-module, cero `application/`/`infrastructure/`/`node:` |
| 9 | Driven ports (interfaces) en `domain/repositories/` o equivalente | OK con A1 | `SecretAuditRepository` en `domain/repositories/`. Los 3 ports (`SecretsScanner`, `PatternRegistry`, `EntropyCalculator`) en `domain/services/` siguiendo el precedente de `WorkspaceDetector` aprobado en Tarea 2 — ver A1 |
| 10 | Ciclos de imports: ninguno | OK | `SecretAction` extraído al propio archivo evita el ciclo aggregate↔event (decisión #1) |
| 11 | Convención `eventName` `"secrets.<kebab-past-tense>"` | OK | 4/4 |
| 12 | Cero `any`, `@ts-ignore`, `console.*`, `process.*` | OK | Verificado |

---

## Veredicto justificado

**APROBADO.** El módulo `secrets/domain` es DDD-correcto y de alta calidad. Cumple los siete criterios obligatorios del checklist (R1-R7) sin excepciones bloqueantes. Las 10 decisiones notables del implementador están bien argumentadas en JSDoc y son técnicamente sólidas:

1. `SecretAction` extraído evita ciclo — refactor estructural correcto (P9).
2. `SecretSource` DU + namespace `SecretSources` — patrón consistente con `LastUsed`/`Scope` aprobado en Tarea 3.
3. `AuditEventId` UUID v7 — consistencia con el resto del proyecto (P19), con la deuda de adapter mapping documentada en A7.
4. `SecretAuditEntry` append-only — promesa de `docs/11-seguridad-modos.md` §6 cumplida estructuralmente (P3).
5. `SecretPattern.matches()` auto-redacta — defensa estructural excelente (P10), evidencia ≠ secret garantizado por el lenguaje.
6. `SecretMatch` invariantes — robustas, con anti-NaN/Infinity (P11).
7. `SanitizedText` cross-field invariant — implementado para el sentido `0 findings ⇒ sanitized = original`, falta el simétrico de bounds checking (A4).
8. `PathSanitizerRule.apply` retorna `Result` — Result-channel correcto per §1.6 (P13).
9. Cap 256 matches/scan — DOS protection localizado en VO (P14).
10. 3 eventos outcome + 1 persistencia — modelo semánticamente correcto (P15).

Las 10 advertencias A1-A10 son **estilísticas, sugerencias de robustez incremental, o deuda compartida con otros módulos** (A1 con workspace, A7-A8 con persistence layer). Ninguna bloquea aprobación individual de Tarea 4. Se recomienda atender A4 (cross-field invariant simétrico en `SanitizedText`) y A7-A8 (ADR de mapping audit_log) antes de cerrar Fase 1, pero pueden manejarse en el ciclo de cierre o en Fase 2 (infrastructure).

Cero hallazgos críticos. Cero violaciones a R1-R7. Cero imports prohibidos. Cero `any`. Cero setters. Eventos correctos. Errores correctos. Repo correcto. VOs correctos. Aggregate correcto.

---

## Próximo paso

1. **Aprobar Tarea 4 — secrets/domain**. El módulo entra a Fase 2 (application + infrastructure) sin cambios obligatorios.
2. **Atender en ciclo de cierre Fase 1 (no bloquea esta tarea):**
   - A4: agregar bounds-check `match.position.end <= original.length` en `SanitizedText.create`.
   - A7 + A8: abrir ADR (puede vivir como nota en `docs/03-modelo-datos.md` §4.8) que documente la estrategia de mapeo entre `AuditEventId` UUID v7 y la columna `INTEGER AUTOINCREMENT` del schema, y la proyección de `workspace_id` (columna nueva con índice compuesto, vs. embed en `args_summary`).
3. **Atender en Fase 2 (no bloquea esta tarea):**
   - A1: decidir si los 3 driven ports (`SecretsScanner`, `PatternRegistry`, `EntropyCalculator`) migran a `application/ports/out/` junto con `WorkspaceDetector` para uniformar con la letra del lineamiento §1.3, o si se mantiene el precedente `domain/services/` aprobado en Tarea 2.
4. **Opcionales (sin urgencia):** A2, A3, A5, A6, A9, A10.

Pasar al `solid-validator` para Tarea 4. Si SOLID también aprueba, el módulo `secrets/domain` queda cerrado en Fase 1.
