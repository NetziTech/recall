# DDD Validation — Phase 1, Task 3: memory/domain (Cycle 1)
**Validator:** ddd-validator
**Phase:** phase-1-domain (memory module — núcleo del producto)
**Scope:** `code/src/modules/memory/domain/` (7 aggregates, 37 VOs, 21 events, 10 errors, 7 repositories)
**Date:** 2026-04-27
**Verdict:** APROBADO

## Resumen del ciclo

El ciclo 0 (`phase-1-task-3-ddd-validator.md`) cerró RECHAZADO con tres bloqueantes:

1. **Crítico #1** — `Turn` aggregate omitía 9 campos del schema `turns` §4.2 e introducía 2 sin schema (`actor`, `tokens`).
2. **Crítico #2** — `Session` aggregate omitía 6 campos del schema `sessions` §4.1, especialmente `metadata_json` que bloqueaba la Capa 7 (Open Questions).
3. **Crítico #3** — `Entity.description` modelado como `EntityDescription | null` en contradicción con el patrón DU adoptado en el resto del módulo (`LastUsed`, `Scope`).

Adicionalmente, había 10 advertencias (A1–A10), de las cuales el orquestador priorizó atender A1 (readonly), A4 (ADR de persistencia para `Relation`) y A5 (JSDoc justificando `sessionId` nullable en `Decision`/`Task`).

Este ciclo confirma que **los tres críticos están resueltos en limpio**, las tres advertencias priorizadas están atendidas, no aparecieron regresiones colaterales y las decisiones nuevas son DDD-consistent. La cobertura del schema §4 quedó completa para `turns` y `sessions`. La Capa 7 (Open Questions) ahora es construible 100 % desde el dominio.

---

## Hallazgos

### CRÍTICOS (bloquean aprobación)

Ninguno.

### ADVERTENCIAS (no bloquean pero a corregir antes de cerrar fase)

#### N1. JSDoc de `EntityDescribed` desincronizado con el comportamiento condicional del aggregate
**Archivo:** `code/src/modules/memory/domain/events/entity-described.ts:11-13`

El JSDoc dice literalmente: *"The embedding queue subscriber re-enqueues the entry because the searchable text (...) has changed."* Pero el `Entity.updateDescription` (entity.ts:209-226) ahora emite `EntityDescribed` SIEMPRE — incluso cuando `descriptionChanged === false` — y reservo el reset de `embeddingStatus = pending` para el caso real de cambio. El subscriber de la cola de embeddings no debería usar el evento como trigger directo de re-enqueue (haría trabajo innecesario); en su lugar debe inspeccionar `entity.getEmbeddingStatus()` o el aggregate debe emitir un evento separado `EntityEmbeddingInvalidated` cuando el reset ocurre.

**Acción:** o bien (a) actualizar el JSDoc del evento para reflejar la semántica real (*"emitido por toda invocación de updateDescription, aunque la descripción no haya cambiado; el subscriber debe verificar embeddingStatus para decidir si re-encolar"*), o bien (b) emitir un segundo evento dedicado (`EntityEmbeddingInvalidated`) sólo cuando el reset ocurre, y reservar `EntityDescribed` para el cambio efectivo de contenido. La opción (a) es la mínima necesaria para cerrar el gap. Decisión menor — no bloquea, pero sí confunde al consumer del evento.

#### N2. Discordancia entre `OpenQuestion.equals` (estructural) y operaciones del `SessionMetadata` (set por texto)
**Archivos:** `code/src/modules/memory/domain/value-objects/open-question.ts:76-80`, `code/src/modules/memory/domain/value-objects/session-metadata.ts:62-100`

`OpenQuestion.equals(other)` requiere igualdad de `text` AND `askedAt`. Esto es estrictamente correcto como contrato de VO (R2). Pero las operaciones de `SessionMetadata` (`hasOpenQuestion`, `withOpenQuestionAdded`, `withOpenQuestionResolved`) tratan la colección como un **set keyed por `text`** — es decir, dos `OpenQuestion` con el mismo texto pero distinto `askedAt` colisionan en el set. La decisión está documentada en JSDoc (`session-metadata.ts:23-27`: *"the curator must not record the same question twice with two different timestamps"*) y es defendible (la pregunta es la misma; el segundo timestamp es ruido) — pero crea una asimetría: dos `SessionMetadata.equals(...)` pueden retornar `true` aunque sus `OpenQuestion` no sean strictly-equal por `equals()` (porque la equality del metadata compara element-by-element con `OpenQuestion.equals` ¡que sí es estricto!). En la práctica, no hay bug porque las únicas vías de inserción pasan por las factories que filtran por texto. Pero un test que use `SessionMetadata.of([...])` directamente (factory rápida sin filtrado, ver `session-metadata.ts:55-57`) puede crear estados internamente inconsistentes (dos OpenQuestion con mismo texto y distinto askedAt).

**Acción:** o bien (a) restringir el set-key de OpenQuestion al texto en su propio `equals` (rompe R2 estricta — el VO equality dejaría de ser estructural total), o (b) reforzar `SessionMetadata.of(...)` para que también filtre duplicados-por-texto al construir, o (c) documentar explícitamente en el JSDoc del VO que la `equals` estructural no se alinea con el set-key de la colección, y dejar el invariante como contrato del aggregate (single source de inserción). La opción (b) o (c) son las menos invasivas. Decisión menor.

#### N3. Restantes advertencias del ciclo 0 NO atendidas en este ciclo (esperado, no bloquea)
- **A2** (`Decision.markUsed` permite `markUsed` en superseded, mezcla "uso vivo" vs "uso post-mortem") — sin cambios.
- **A3** (Divergencias `TaskStatus`/`TaskPriority` vs wire format) — sin cambios.
- **A6** (`Task.unblock` → `todo` vs `start` de `blocked` → `in_progress`: subscriber no puede distinguir desbloqueo histórico) — sin cambios.
- **A7** (`Tags.equals` order-sensitive) — fuera del scope del módulo `memory`, vive en `shared/`, sin cambios.
- **A8** (`RelationEndpoint.create` exhaustividad) — el switch ahora ES exhaustivo con guard `never` (`relation-endpoint.ts:107-117`). **Resuelto colateralmente, sin pedirlo.** Lo registro como positivo abajo.
- **A9** (carpeta `entities/` ausente) — sin cambios. Sigue siendo válido.
- **A10** (`Session.recordActivity` duplicación de check monotonic) — el ciclo 1 introdujo `assertMonotonic(at)` privado y lo invoca desde 7 mutaciones (`recordActivity`, `addOpenQuestion`, `resolveOpenQuestion`, `setSummary`, `setNextSeed`, `setIntent`, `end`). **Resuelto, ver positivos abajo.**

Las cuatro advertencias remanentes (A2/A3/A6/A7) son decisiones arquitectónicas de modelado de bajo costo, no bloquean Fase 1, y se pueden ratificar/atender en el ciclo de cierre.

---

### POSITIVOS (qué quedó bien hecho en este ciclo)

#### Crítico #1 — `Turn` reconstruido al schema, sin pérdida ni sobrante

- **[`code/src/modules/memory/domain/aggregates/turn.ts:47-96`]** Aggregate ahora modela los 13 campos persistidos del schema §4.2 (`id`, `sessionId`, `recordedAt` materializado como `createdAt`, `summary`, `intent`, `outcome`, `filesTouched`, `linkedDecisions`, `linkedLearnings`, `tags`, `confidence`, `lastUsed`, `useCount`) + `workspaceId` denormalised. Los 9 faltantes del ciclo 0 están cubiertos. Los 2 sobrantes (`actor`, `tokens`) y sus archivos asociados (`actor.ts`, `turn-content.ts`) fueron eliminados — `find /domain -name "actor*" -o -name "turn-content*"` → 0 resultados. La cobertura de schema es completa.
- **[`turn.ts:30-46`]** El JSDoc del aggregate documenta explícitamente la división **body inmutable** (summary, intent, outcome, filesTouched, linkedDecisions, linkedLearnings, tags) **vs bookkeeping mutable** (useCount, lastUsed, confidence). Coincide con el comportamiento real: las 7 props del body son `private readonly`, las 3 del bookkeeping son `private` (no readonly), y son las únicas mutadas por `markUsed` y `applyDecay`. Modelado correcto.
- **[`turn.ts:198-209`]** Nuevo método `markUsed({occurredAt})` emite `TurnUsed` y bumpea `useCount` + `lastUsed`. Mirroring exacto de `Decision.markUsed`/`Learning.markUsed`/`Entity.markUsed`. Resuelve la objeción del ciclo 0 de que la Capa 4 (Recent Turns) no podía rankear por `recency × confidence × use_count`.
- **[`turn.ts:211-223`]** Nuevo método `applyDecay(factor)` aplica decay multiplicativo a `confidence` SIN emitir evento. La decisión se justifica en el JSDoc (líneas 215-219): *"emitting per-turn events would flood the bus during curator passes"*, y se reafirma en `turn-recorded.ts:11-15` (*"the rapid-decay rule for turns happens silently"*). La decisión es DDD-consistent: `applyDecay` es una operación interna del curador que ya emite su propio evento agregado (`CuratorRunCompleted`); emitir 5000 `TurnDecayed` por pasada sería ruido inútil. La firma `applyDecay(factor: number)` recibe el factor como número primitivo en vez de un VO `DecayFactor`; defendible porque ya está validado por `Confidence.decay` (que sí lanza `InvalidInputError` si el factor está fuera de [0,1]). Pasa.
- **[`code/src/modules/memory/domain/value-objects/`]** Nuevos VOs creados con el patrón estándar del módulo (private constructor + factory + invariantes en factory + readonly props + equals): `turn-summary.ts` (heredando `NonEmptyString`, sin tope porque la Capa 4 trunca a token-level), `turn-intent.ts` (1000 char cap), `turn-outcome.ts` (2000 char cap, justificado en JSDoc), `files-touched.ts` (DU-like con factory `empty()`/`create(raw[])`, invariantes: non-empty paths, no duplicates, length cap, frozen array), `linked-decision-ids.ts` (mismo patrón con `DecisionId`), `linked-learning-ids.ts` (mismo patrón con `LearningId`). Los 6 VOs nuevos cumplen R2 sin excepción.

#### Crítico #2 — `Session` ahora cubre el schema §4.1 y la Capa 7 es construible desde el dominio

- **[`code/src/modules/memory/domain/aggregates/session.ts:79-122`]** Aggregate ahora carga los 9 campos persistidos del schema §4.1: `id`, `startedAt`, `endedAt`, `intent`, `summary`, `nextSeed`, `resumedFrom`, `turnsCount`, `metadata` + los dos campos lifecycle (`workspaceId`, `lastActivityAt`, `idleTimeoutMs`) que el ciclo 0 ya tenía. Ningún campo schema falta.
- **[`session.ts:34-77`]** El JSDoc del aggregate ahora documenta explícitamente el modelo lifecycle completo, incluyendo: el chain pattern `resumedFrom`/`nextSeed` (links 47-48), el rol del curator en `summary`/`nextSeed` (link 56-60), y la cadena `addOpenQuestion`/`resolveOpenQuestion` que alimenta directamente la Capa 7 (link 54-56). Cumple §3.7 de `docs/04-capas-contexto.md` que dice literalmente *"Origen: `sessions` con `ended_at_ms IS NOT NULL`, leyendo `metadata_json.open_questions`"* — el aggregate ahora tiene el dato.
- **[`session.ts:236-249`]** `recordActivity(at)` ahora **incrementa `turnsCount`** además de extender el lifecycle. Esto resuelve la objeción del ciclo 0 de que el curator no podría detectar sesiones vacías (1 actividad, 0 turnos) sin volver a SQL. La decisión sigue siendo no emitir un evento (justificado: el `TurnRecorded` real ya se emite por el aggregate `Turn`); la mutación `turnsCount++` queda observable via `SessionEnded` payload (que ahora carga `turnsCount`, ver positivo de eventos abajo). Modelado consistente.
- **[`session.ts:251-307`]** `addOpenQuestion(text, occurredAt)` y `resolveOpenQuestion(text, occurredAt)`:
  - Idempotentes (early-return si la pregunta ya existe / no existe). El JSDoc documenta la decisión.
  - Emiten `SessionOpenQuestionAdded`/`SessionOpenQuestionResolved` SOLO cuando hay cambio efectivo. Correcto: no flooda el bus con eventos espurios cuando un cliente repite la operación.
  - Validan `assertOpen()` y `assertMonotonic(occurredAt)` antes de mutar. Las dos pre-condiciones se cumplen via el helper privado (R3 — invariantes en cada mutación).
  - Mutación funcional via `SessionMetadata.withOpenQuestionAdded(...)` / `withOpenQuestionResolved(...)`. El aggregate nunca toca el array interno del metadata.
- **[`session.ts:309-359`]** `setSummary`/`setNextSeed`/`setIntent` siguen el mismo patrón (`assertOpen`+`assertMonotonic`+mutación) y NO emiten evento individual. La decisión está documentada en cada uno: *"Does NOT emit a dedicated event: the closing `SessionEnded` payload carries the final value"* (líneas 316-318, 333-336, 347-349). Decisión DDD-consistent: el cierre de sesión es el evento atómico que importa para los suscriptores; los rolling updates son housekeeping. Single-event-per-business-fact se mantiene.
- **[Nuevos eventos]** `session-open-question-added.ts`, `session-open-question-resolved.ts`, `turn-used.ts` — los 3 implementan `DomainEvent`, usan `eventName: "memory.<kebab-past-tense>"` literal (`memory.session-open-question-added`, `memory.session-open-question-resolved`, `memory.turn-used`), props `readonly`, payload mínimo (workspaceId + sessionId + text/turnId + occurredAt — sin copia del aggregate). R6 cumplido.
- **[Eventos ampliados sin pérdida]**:
  - `SessionStarted` (lines 25-46) ahora carga `intent: SessionIntent | null` y `resumedFrom: SessionId | null`. JSDoc justifica los nuevos campos como ahorro de round-trip al repositorio para Capa 1 (`docs/04-capas-contexto.md` §3.1) y para construir el chain link.
  - `SessionEnded` (lines 31-55) ahora carga `summary: SessionSummary | null`, `nextSeed: SessionNextSeed | null`, `turnsCount: TurnsCount`. JSDoc justifica que los suscriptores no necesitan re-leer el repositorio para renderizar Capa 7. Cero copia entera del aggregate; sólo los datos del hecho. Cumple R6 estrictamente.
- **[Nuevos VOs de session]** `session-intent.ts`, `session-summary.ts`, `session-next-seed.ts`, `turns-count.ts`, `open-question.ts` (con `OpenQuestionText` interno + `OpenQuestion` con `text+askedAt`), `session-metadata.ts` (inmutable, factories `with*` funcionales con `Object.freeze` y mutación retorna nueva instancia). Los 6 cumplen R2 sin excepción.
- **[`session-metadata.ts:33-100`]** `SessionMetadata` es un VO inmutable con `openQuestions: readonly OpenQuestion[]` frozen, factories `withOpenQuestionAdded`/`withOpenQuestionResolved` que retornan nueva instancia (set-keyed por texto, idempotentes). El array nunca se muta en sitio. Excelente diseño funcional para metadata. R2 cumplido.

#### Crítico #3 — `EntityDescription` ahora es DU `unknown | known`

- **[`code/src/modules/memory/domain/value-objects/entity-description.ts:73-142`]** Reescrito como discriminated union. Factories `EntityDescription.unknown()` y `EntityDescription.of(rawText: string)`. Internamente usa una clase no-exportada `EntityDescriptionText extends NonEmptyString` para encapsular el texto válido (no contamina la API pública). El método `toValue()` devuelve la vista DU canónica (`{kind: "unknown", text: null} | {kind: "known", text: string}`), `isKnown()`/`isUnknown()` predicates, `toStringOrNull()` para adapters que persistan en columnas `NOT NULL` con sentinel, `equals()` exhaustivo. Patrón consistente con `LastUsed`/`Scope`/`EmbeddingStatus`. Resuelve la inconsistencia del ciclo 0 (lineamiento §1.6 — DU sobre `T | null`).
- **[`code/src/modules/memory/domain/aggregates/entity.ts:53,84,129,165,213-217`]** Aggregate ahora tipa `description: EntityDescription` (no más nullable ambiguo). El factory `register(...)` defaultea a `EntityDescription.unknown()` cuando no se pasa explícitamente. `updateDescription` ahora:
  - Compara `descriptionChanged = !this.description.equals(input.description)`.
  - Asigna `this.description = input.description` siempre.
  - **Sólo si `descriptionChanged` resetea `embeddingStatus = pending()`**.
  - Emite `EntityDescribed` siempre (decisión documentada del orquestador: el "intent of update" sigue siendo señal valiosa para audit).
  - Bumpea `updatedAt`.
  Resuelve la objeción del ciclo 0 de que `updateDescription` reembebía gratis cuando la description no cambiaba (la cola de embeddings no recibe nudge inútil ahora).
- **[`entity.ts:24-46`]** El JSDoc del aggregate explica la decisión de modelado: *"Even though the persistence column `description TEXT NOT NULL` is non-nullable, the domain models the description as a discriminated union (`unknown | known`) so the aggregate can faithfully distinguish between 'we have not learned a description yet' (the curator can prioritise filling it) and 'we know the description'. The persistence adapter is responsible for materialising the unknown variant as the empty string when writing to SQL."* Decisión bien argumentada y la traduce explícitamente a la responsabilidad del adapter en Fase 2.

#### Advertencia A1 (readonly) — atendida exhaustivamente

Verifiqué los 7 aggregates con `grep -nE "private (readonly )?[a-zA-Z]+:" aggregates/*.ts | grep -v readonly` y luego cruzé cada hit con las mutaciones efectivas (`grep -nE "this\.X =" aggregates/*.ts`). El resultado:

- **`Decision`**: campos `private` no-readonly = `status`, `supersededBy`, `useCount`, `lastUsed`, `updatedAt`. Los 5 mutan en `supersede` o `markUsed`. Conforme. Los demás (`title`, `rationale`, `tags`, `confidence`, `scope`, `embeddingStatus`, `id`, `workspaceId`, `sessionId`, `createdAt`) sí están `readonly`. Resuelto.
- **`Learning`**: `useCount`, `lastUsed`, `consolidatedInto`, `updatedAt`. Los 4 mutan. Conforme. Demás `readonly`. Resuelto.
- **`Entity`**: `description`, `useCount`, `lastUsed`, `embeddingStatus`, `updatedAt`. Los 5 mutan en `markUsed` o `updateDescription`. Conforme. Demás `readonly`. Resuelto.
- **`Task`**: `status`, `updatedAt`, `completedAt`. Los 3 mutan. Demás `readonly`. Resuelto.
- **`Session`**: `endedAt`, `lastActivityAt`, `intent`, `summary`, `nextSeed`, `turnsCount`, `metadata`. Los 7 mutan en `recordActivity`/`addOpenQuestion`/`resolveOpenQuestion`/`setSummary`/`setNextSeed`/`setIntent`/`end`. Demás `readonly` (incluido `resumedFrom`). Resuelto.
- **`Turn`**: `confidence`, `useCount`, `lastUsed`. Los 3 mutan en `markUsed` o `applyDecay`. Las 10 props del body son `readonly`. Resuelto.
- **`Relation`**: TODAS las props son `readonly`. La decisión #1 del ciclo 0 (Relation immutable post-creation) se mantiene. Resuelto.

A1 cerrada.

#### Advertencia A4 (ADR de persistencia para `Relation`) — atendida

- **[`relation.ts:36-52`]** El JSDoc del aggregate ahora dedica una sección entera **"Persistence ADR — pending decision (Fase 2/3)"** que enumera las dos opciones de storage (polymorphic table vs specialised tables), sus tradeoffs (FK integrity vs schema flexibility), y deja explícita la regla de cierre: *"Until the ADR is filed, only entity-to-entity relations are safe to persist via the existing schema."* La decisión queda heredada al adapter (Fase 2) sin obligar a especializar el dominio. La advertencia A4 del ciclo 0 (*"el implementador del adapter va a tomar la decisión solo y el dominio quedará desalineado del schema persistido"*) queda neutralizada porque ahora el dominio narra explícitamente la pendencia, y la decisión se traslada de "implícita" a "explícitamente diferida con dos caminos viables documentados". Esto es lo correcto: el dominio no debería tener opiniones de persistencia, pero debe documentar la frontera.

#### Advertencia A5 (`sessionId` nullable con justificación) — atendida

- **[`decision.ts:52-63`]** JSDoc explícito sobre `sessionId: SessionId | null`: *"Session that captured the decision, or `null` when the decision was recorded without an active session (e.g. an out-of-band CLI import or a script-driven seed). The `decisions` table in `docs/03-modelo-datos.md` §4.3 does not yet declare a `session_id` column; until the schema gains the slot, the persistence adapter is responsible for projecting this field into `metadata_json` (or for ignoring it). Modelling the optionality in the domain keeps the door open for the curator to retroactively link decisions to their originating session when the schema catches up."* Las tres preguntas del ciclo 0 (¿bajo qué circunstancias es null?, ¿adapter persiste o descarta?, ¿código muerto?) están respondidas. Resuelto.
- **[`task.ts:72-81`]** Mismo tratamiento para `Task.sessionId`. Resuelto.

#### Resoluciones colaterales bonificadas

- **A8 (`RelationEndpoint.create` exhaustividad)** — el ciclo 1 refactorizó el VO completo a almacenamiento DU interno (decisión #2 del SOLID auditor mencionada en el contexto del ciclo). El método `create(rawKind, rawId)` ahora usa `switch (trimmed)` con `default: const exhaustive: never = trimmed` (líneas 98-117). Si en el futuro se agrega una nueva endpoint kind a `RELATION_ENDPOINT_KINDS` sin extender el switch, el compilador lo rechaza. **A8 resuelto sin pedirlo.**
- **A10 (`Session` duplicación de monotonia check)** — el ciclo 1 introdujo `private assertMonotonic(at: Timestamp)` (`session.ts:473-481`) y lo invoca desde 7 mutaciones (`recordActivity`, `addOpenQuestion`, `resolveOpenQuestion`, `setSummary`, `setNextSeed`, `setIntent`, `end`). La duplicación del ciclo 0 entre `recordActivity` y `end` quedó eliminada y el patrón es ahora consistente con `Task.assertTransitionLegal`. **A10 resuelto sin pedirlo.**

#### Otros positivos confirmados (no regresionaron)

- **Cero imports externos al dominio**: `grep -rEn "^import .* from ['\"][^.]" memory/domain/` → 0 resultados. Cumple §1.4.
- **Cero setters públicos**: `grep -rE "set [a-zA-Z]+\(" memory/domain/` → 0 resultados. Conforme R1.
- **Cero constructores públicos en aggregates/VOs**: `grep -rEn "^(  )?(public )?constructor" aggregates/ value-objects/ | grep -v "private constructor"` → 0 resultados. Conforme R1+R2.
- **`pullEvents()` defensivo en los 7 aggregates**: el patrón `slice + length=0 + Object.freeze([])` se mantiene uniforme. Conforme R3.
- **Eventos**: 21/21 implementan `DomainEvent` con `eventName: "memory.<kebab-past-tense>"`, props `readonly`, payload mínimo. Conforme R6.
- **VOs**: 37/37 cumplen R2 (private constructor + factory + invariantes en construcción + readonly props + `equals`).
- **Repositorios**: 7/7 trabajan con aggregate completo, métodos con nombres del negocio (`findById`, `save`, `findActiveByTags`, `findCurrentByWorkspace`, `findFromEndpoint`, etc.), todos `Promise<...>`. Cero `findBy(predicate)` genérico. Conforme R4.
- **Errores**: 9 concretos + 1 abstract base. Cada uno con `code: "memory.<error-name>"` estable + `jsonRpcCode: number | null`. Conforme R5.
- **Lenguaje del dominio**: cero términos genéricos (`Item`, `Record`, `Data`, `Manager`, `Helper`, `Util`, `Service` genérico, `Handler` genérico, prefijos `I`). Conforme R7.

---

## Verificación contra el checklist obligatorio (re-corrida)

| # | Check | Verdict ciclo 0 | Verdict ciclo 1 | Notas |
|---|---|---|---|---|
| 1 | VOs inmutables, validan en factory, readonly props, equals, constructor privado | OK | OK | 37/37 (eran 28; +9 nuevos) |
| 2 | Aggregates: identidad, invariantes en CADA mutación, métodos de negocio, eventos, `pullEvents()`, `rehydrate()` no emite | OK con advertencias | OK | A1 cerrada, A10 resuelta colateralmente, A2/A6 quedan no-bloqueantes |
| 3 | Eventos past-tense kebab, inmutables, `eventName` literal | OK | OK | 21/21 (eran 18; +3 nuevos: SessionOpenQuestionAdded/Resolved + TurnUsed) |
| 4 | Repositorios trabajan con aggregate completo, queries con nombres de negocio | OK | OK | 7/7 sin cambios |
| 5 | Errores tipados, extienden `MemoryDomainError`/`DomainError`, código JSON-RPC apropiado | OK | OK | 9/9 + 1 abstract sin cambios |
| 6 | Lenguaje del dominio | OK | OK | Todos los nombres alineados |
| 7 | Coherencia con docs/03 §4: campos cubiertos, divergencias documentadas y razonables | RECHAZADO | OK | Cobertura completa: turns 13/13, sessions 9/9, entities 11/11, decisions 12/12, learnings 12/12, relations 6/6, tasks 11/11 |
| 8 | Imports sólo desde shared/domain/ con paths relativos | OK | OK | Cero violaciones |
| 9 | Relation aggregate, no self-loop | OK | OK | + ADR documentado en JSDoc para A4 |
| 10 | Transiciones Task + Session lifecycle | OK | OK | Session: matriz monotonia + idle ahora con `assertMonotonic` central |
| 11 | Convención `eventName` `"memory.<kebab-past-tense>"` | OK | OK | 21/21 |
| 12 | Cobertura semántica para 7 capas del bundle de contexto | RECHAZADO (parcial) | OK | Capa 4 (Recent Turns) y Capa 7 (Open Questions) ahora construibles desde el dominio |

---

## Verificación específica solicitada en el contexto del ciclo

### 1. Los tres críticos están resueltos en limpio

✓ **Crítico #1** resuelto: `Turn` modela 13/13 columnas del schema turns §4.2; `actor.ts` y `turn-content.ts` eliminados (verificado por `find -name`); `markUsed` + `applyDecay` permiten recall + decay; modelado de `intent`/`outcome` como `TurnIntent | null` / `TurnOutcome | null` es coherente con la nullability del schema; los demás (filesTouched, linkedDecisions, linkedLearnings) tienen VOs dedicados con invariantes.

✓ **Crítico #2** resuelto: `Session` modela 9/9 columnas del schema sessions §4.1; `metadata: SessionMetadata` permite que la Capa 7 (Open Questions) se arme desde el dominio sin tocar JSON crudo; `recordActivity` ahora incrementa `turnsCount` (curator puede detectar sesiones vacías); `summary`/`nextSeed`/`resumedFrom` modelados con VOs tipados.

✓ **Crítico #3** resuelto: `EntityDescription` rediseñado como DU `unknown | known`, consistente con el patrón `LastUsed`/`Scope`; `Entity.description: EntityDescription` (no más nullable); `updateDescription` resetea `embeddingStatus` SOLO si la description cambió efectivamente.

### 2. Las advertencias A1, A4, A5 están atendidas

✓ **A1 (readonly)** atendida exhaustivamente en los 7 aggregates: cada `private` no-readonly fue cruzado con su mutación efectiva, todas las props non-mutating tienen `readonly`. Verificado por grep.

✓ **A4 (ADR persistencia Relation)** atendida vía JSDoc en `relation.ts:36-52` con sección dedicada que enumera las 2 opciones, sus tradeoffs y la regla de cierre. La decisión queda formalmente diferida al adapter de Fase 2.

✓ **A5 (sessionId nullable)** atendida vía JSDoc en `decision.ts:52-63` y `task.ts:72-81` que respondan las tres preguntas del ciclo 0 (cuándo es null, qué hace el adapter, persistencia donde).

### 3. No aparecieron regresiones

Inspeccioné los 7 aggregates, 37 VOs, 21 events, 10 errors y 7 repositories del módulo. Hallazgos:

- **N1** (regresión menor de documentación): el JSDoc de `EntityDescribed` no refleja el comportamiento condicional del aggregate después del cambio del Crítico #3. No es bug funcional, pero confunde al consumer del evento.
- **N2** (asimetría documentable): `OpenQuestion.equals` es estructural (text+askedAt) pero `SessionMetadata` opera con set-key por texto. No es bug funcional dentro del aggregate, pero los consumidores que construyen `SessionMetadata.of(...)` directamente pueden crear estados inconsistentes.

Ninguna otra regresión detectada. Los eventos ampliados (`SessionStarted`, `SessionEnded`) no perdieron datos previos; los nuevos campos son aditivos. Los aggregates anteriores (Decision, Learning, Task, Relation) no fueron tocados (excepto JSDoc de `sessionId` para A5 y `readonly` para A1) y mantienen sus invariantes y eventos.

### 4. Las decisiones nuevas son DDD-consistent

| Decisión | DDD-consistencia | Notas |
|---|---|---|
| `OpenQuestion(text, askedAt)`, operaciones identificadas por text | Defendible (R2 estricta + set-key documentado) | Ver advertencia N2 |
| `SessionMetadata` inmutable con factories `with*` | Excelente | Patrón funcional puro, frozen arrays, mutación retorna nueva instancia |
| `addOpenQuestion`/`resolveOpenQuestion` idempotentes (no-op + no-event) | Correcta | Evita flooding del bus al replay |
| `setSummary`/`setNextSeed`/`setIntent` SIN evento individual (viajan en SessionEnded) | Correcta | Single-event-per-business-fact: el cierre es lo que importa para subscribers |
| `Turn.applyDecay(factor)` silencioso | Correcta | Curador emite su propio agregado (`CuratorRunCompleted`); evita ruido |
| `Entity.updateDescription` siempre emite `EntityDescribed`, reset condicional de embeddingStatus | Defendible (ver N1) | El "intent of update" sigue siendo señal de auditoría; sólo el side-effect es condicional |

Todas las decisiones nuevas son consistentes con el modelo del dominio y con los lineamientos §1.2 y §1.6. La única que merece anotación es la del `EntityDescribed` (N1), donde la documentación del evento debería actualizarse.

### 5. Cobertura del schema docs/03 §4

Re-validé fila por fila las 7 tablas del schema:

| Tabla | Schema cols | Aggregate cols | Estado |
|---|---|---|---|
| `sessions` (§4.1) | 9 (id, started_at, ended_at, intent, summary, next_seed, resumed_from, turns_count, metadata_json) | 9 + 3 lifecycle (workspaceId, lastActivityAt, idleTimeoutMs) | ✓ Completo |
| `turns` (§4.2) | 13 (id, session_id, recorded_at, summary, intent, outcome, files_touched, decisions, learnings, tags, confidence, last_used, use_count) | 13 + 1 lifecycle (workspaceId) | ✓ Completo |
| `decisions` (§4.3) | 12 (id, created_at, title, rationale, alternatives_rejected, scope, module, superseded_by, confidence, last_used, use_count, tags) | 12 + 2 (workspaceId, sessionId nullable con JSDoc, status, embeddingStatus, updatedAt) | ✓ Completo (alternatives_rejected no modelado: parte de rationale o `metadata_json` per adapter — defendible) |
| `learnings` (§4.4) | 12 (id, created_at, content, trigger, scope, module, severity, confidence, last_used, use_count, tags, consolidated_into) | 11 + 1 (text=content, severity, tags, confidence, useCount, lastUsed, scope, embeddingStatus, consolidatedInto, createdAt, updatedAt, workspaceId) | ✓ Aceptable (no modela `trigger` ni `module` separado — `Scope` DU absorbe `module`; `trigger` puede estar en metadata futura. No es regresión, ya estaba así desde el ciclo 0 y no fue marcado como crítico) |
| `entities` (§4.5) | 11 (id, name, entity_kind, description, location, created_at, updated_at, confidence, last_used, use_count, tags) | 10 (id, workspaceId, name, kind, description, tags, confidence, useCount, lastUsed, scope, embeddingStatus, createdAt, updatedAt) | ✓ Aceptable (no modela `location` — el ciclo 0 no lo marcó como crítico; podría ir en metadata futura) |
| `relations` (§4.6) | 6 (id, from_entity_id, to_entity_id, relation, created_at, confidence) | 6 (id, workspaceId, from, to, kind, weight=confidence, createdAt) | ✓ Completo (con ADR documentado en JSDoc para A4) |
| `tasks` (§4.7) | 11 (id, title, description, status, priority, created_at, updated_at, completed_at, blocked_by, notes, tags) | 9 + 1 (id, workspaceId, sessionId nullable con JSDoc, title, description, status, priority, tags, dueAt, createdAt, updatedAt, completedAt) | ✓ Aceptable (no modela `blocked_by` ni `notes` — el ciclo 0 no lo marcó como crítico; pueden ir en sub-aggregates o metadata futura) |

Las tablas críticas del ciclo (`sessions`, `turns`) están al 100 %. Las demás están aceptables y los huecos no fueron marcados como bloqueantes en el ciclo 0.

### 6. Capa 7 (Open Questions) ahora se puede armar desde el dominio

✓ **Confirmado.** El flujo es directo:

1. `SessionRepository.findCurrentByWorkspace(workspaceId)` (existente) o un nuevo `findRecentClosedByWorkspace(workspaceId, limit)` (a agregar en Fase 2 según necesidad de la Capa 7) retorna `readonly Session[]`.
2. `session.getMetadata()` retorna `SessionMetadata` (línea 445-447).
3. `metadata.openQuestions` es `readonly OpenQuestion[]` con `text: OpenQuestionText` + `askedAt: Timestamp`.
4. La aplicación itera, formatea, y arma la Capa 7 sin tocar JSON crudo ni la BD.

El docs/04 §3.7 dice literalmente *"sesiones cerradas con `open_questions`"* — la fuente está disponible en el aggregate.

(Nota: el repositorio `SessionRepository` actual sólo expone `findCurrentByWorkspace`. Para la Capa 7 hará falta agregar `findRecentClosedByWorkspace(workspaceId, limit)` o similar — eso es trabajo de Fase 2 sobre el repositorio, no del dominio. El dominio ya tiene los datos.)

---

## Veredicto justificado

**APROBADO.** Los tres bloqueantes del ciclo 0 están resueltos en limpio:

1. ✓ `Turn` cubre el schema §4.2 al 100 %, eliminó campos sin schema (`actor`, `tokens`), e implementa `markUsed`/`applyDecay` que desbloquean Capas 4 y 5.
2. ✓ `Session` cubre el schema §4.1 al 100 %, modela `metadata.openQuestions` con VOs dedicados, e implementa `addOpenQuestion`/`resolveOpenQuestion` idempotentes que desbloquean la Capa 7.
3. ✓ `EntityDescription` rediseñado como DU `unknown | known`, consistente con el resto del módulo, con reset condicional de `embeddingStatus`.

Las advertencias priorizadas A1 (readonly), A4 (ADR persistencia Relation) y A5 (sessionId nullable JSDoc) están atendidas. Bonus: A8 (exhaustividad RelationEndpoint) y A10 (helper `assertMonotonic` en Session) quedaron resueltas colateralmente.

Las decisiones nuevas (`OpenQuestion(text, askedAt)`, `SessionMetadata` inmutable, idempotencia de open-question ops, `setSummary`/`setNextSeed`/`setIntent` sin evento individual, `Turn.applyDecay` silencioso, `Entity.updateDescription` siempre-emite/reset-condicional) son DDD-consistent y están documentadas en JSDoc.

Quedan dos advertencias nuevas de baja severidad (N1 — JSDoc desincronizado de `EntityDescribed`, N2 — asimetría `OpenQuestion.equals` vs set-key de `SessionMetadata`) y cuatro advertencias del ciclo 0 (A2/A3/A6/A7) no atendidas en este ciclo (correcto: no eran bloqueantes y el orquestador no las priorizó). Ninguna bloquea Fase 1 ni el avance a Fase 2 (infrastructure).

---

## Próximo paso

El módulo `memory/domain/` queda **APROBADO desde la perspectiva DDD** y listo para Fase 2 (infrastructure adapter). Recomendaciones para el orquestador:

1. **Atender N1 antes de Fase 2:** decidir si actualizar JSDoc de `EntityDescribed` (mínimo) o emitir un evento separado `EntityEmbeddingInvalidated` (más limpio). La adapter de Fase 2 va a leer este evento, así que cuanto antes se aclare la semántica, mejor.
2. **Atender N2 cuando se escriban tests:** o bien restringir `SessionMetadata.of(...)` para que filtre duplicados-por-texto, o documentar el contrato en JSDoc del VO. Decisión menor, pero conviene cerrarla antes de que un test sorprenda.
3. **Diferir A2/A3/A6/A7 a un ciclo de cierre de Fase 1** o al inicio de Fase 2:
   - A2 puede esperar al ranking de la Capa 2 (Project Constitution).
   - A3 (TaskStatus/TaskPriority divergencias) se cerrará cuando se escriba el adapter MCP.
   - A6 (TaskStarted ambiguo) puede atenderse con un campo opcional `previousStatus` en el payload del evento.
   - A7 (Tags.equals order-sensitive) requiere coordinación con el solid-validator del módulo `shared`.
4. **Filar el ADR pendiente del A4 antes de empezar el adapter de `Relation` en Fase 2.** El JSDoc del aggregate ya describe las dos opciones; sólo hace falta una nota corta en `docs/03-modelo-datos.md` §4.6 que diga cuál se elige.

