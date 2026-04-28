# DDD Validation — Phase 1, Task 3: memory/domain
**Validator:** ddd-validator
**Phase:** phase-1-domain (memory module — núcleo del producto)
**Scope:** `code/src/modules/memory/domain/` (63 archivos: 7 aggregates, 28 VOs, 18 events, 10 errors, 7 repositories, 0 entities, 0 services)
**Date:** 2026-04-27
**Verdict:** RECHAZADO

Hallazgo bloqueante único: el aggregate `Turn` no modela campos del schema documentado (intent / outcome / files_touched / decisions / learnings / tags / confidence / last_used / use_count) y a la vez introduce dos campos nuevos (`actor`, `tokens`) que no existen en `docs/03-modelo-datos.md` §4.2. Ambas direcciones de la divergencia van más allá de las cuatro decisiones notables del implementador y dejan al dominio incapaz de cubrir las capas 4 y 5 del bundle de contexto. Detalle abajo.

El resto del módulo es DDD-correcto y de alta calidad: 28 VOs con `private constructor` + factory + `equals()` + invariantes en construcción, 7 aggregates con identidad inmutable, mutaciones por verbos del negocio, eventos en past-tense kebab y `pullEvents()` defensivo, 10 errores tipados con código estable y mapeo JSON-RPC opcional, 7 repos sin `findBy(predicate)` genérico, y cero imports fuera de `shared/domain/` ni de otros módulos. La decisión de modelar `Relation` como aggregate root (decisión #1) y la matriz `ALLOWED_TASK_TRANSITIONS` (decisión #3) están bien argumentadas y son correctas.

---

## Hallazgos

### CRÍTICOS (bloquean aprobación)

#### 1. `Turn` (aggregate) — pérdida de cobertura del schema y mutación silenciosa del modelo
**Archivos:** `code/src/modules/memory/domain/aggregates/turn.ts:35-93`, `code/src/modules/memory/domain/value-objects/turn-content.ts:24-29`

`docs/03-modelo-datos.md` §4.2 define la fila `turns` con 12 columnas significativas:
`summary, intent, outcome, files_touched_json, decisions_json, learnings_json, tags_json, confidence, last_used_ms, use_count` (más `id, session_id, recorded_at_ms`).

El aggregate entregado modela:
`id, workspaceId, sessionId, actor, content, tokens, createdAt`.

Es decir:
- **Faltan 9 campos del schema:** `intent`, `outcome`, `files_touched`, `decisions`, `learnings`, `tags`, `confidence`, `last_used`, `use_count`.
  - El comentario en `turn.ts:30-33` reconoce sólo `intent`/`outcome` como "open question" — los otros 7 quedan sin modelar y sin justificación documentada.
  - Sin `tags`, `confidence`, `last_used`, `use_count`, el Turn queda fuera del decay/recall/scoring (`docs/03-modelo-datos.md` §5 — "searchable_text por kind: turn: summary + intent + outcome"; `docs/04-capas-contexto.md` §3.4 — "Decay rapido. confidence baja 0.05 por dia"). El curador no podrá decay-ear turns y la Capa 4 no podrá rankearlos por recency × confidence × use_count.
- **Sobran 2 campos sin schema:** `actor` y `tokens`.
  - `actor` (`Actor` VO, `user|assistant`) no aparece en §4.2 ni en `mem.remember({kind:"turn"})` (`docs/02-protocolo-mcp.md` §4.4). El comentario en `actor.ts:7-10` argumenta "implícito en docs 04 §3 / 01 §6" pero ninguna de esas secciones lo define como campo persistido. El persistor SQLite no tendrá columna donde guardarlo.
  - `tokens` no aparece en §4.2 (sólo en VOs cross-modulo y en presupuestos de capa). En `04-capas-contexto.md` §10 `Tokens` se calcula on-the-fly via `tiktoken`/heurística, no se persiste por turn. Modelarlo en el aggregate obliga al cliente a entregarlo en `mem.remember`, pero el protocolo no lo define.

`TurnContent.from(...)` además decide explícitamente NO acotar longitud (`turn-content.ts:14-19`) delegando en el bundle layer; la decisión es defendible para el body, pero deja sin tipar los campos `intent`/`outcome` del schema (que son pequeños y *sí* deberían tener su propio VO). El aggregate no puede emitir `TurnRecorded` con esa información porque ni siquiera la guarda.

**Impacto en la cobertura semántica de las 7 capas (checklist obligatorio §12):**
- Capa 4 (Recent Turns) no puede rankear por `confidence × last_used × use_count` porque no están en el aggregate.
- Capa 5 (Relevant Memory hybrid search) no puede tokenizar `intent + outcome` porque no existen.
- Capa 7 (Open Questions) lee `sessions.metadata_json.open_questions` (ver punto crítico #2) que no se persiste tampoco.

**Camino sugerido (decisión del orquestador):**
1. **Conformar al schema:** ampliar `Turn` para llevar `intent: TurnContent | null`, `outcome: TurnContent | null`, `tags: Tags`, `confidence: Confidence`, `lastUsed: LastUsed`, `useCount: UseCount` (mismo set que Decision/Learning/Entity), y agregar VOs `FilesTouched`, `DecisionsLinked`, `LearningsLinked` (o un único `TurnAttachments` con DU). Los `markUsed`/decay seguirán el mismo patrón. Eliminar `actor` y `tokens` o moverlos a `metadata_json` si el orquestador los considera valor agregado.
2. **Modificar el schema:** si el modelo *quiere* `actor` y `tokens` y prescindir de los nueve campos faltantes, abrir ADR que actualice `docs/03-modelo-datos.md` §4.2 y `docs/02-protocolo-mcp.md` §4.4 (`mem.remember`).

Sin alguna de las dos vías, el dominio no representa fielmente el negocio que ya está documentado.

#### 2. `Session` (aggregate) — campos del schema sin modelar
**Archivo:** `code/src/modules/memory/domain/aggregates/session.ts:52-77`

`docs/03-modelo-datos.md` §4.1 define `sessions` con: `id, started_at_ms, ended_at_ms, intent, summary, next_seed, resumed_from, turns_count, metadata_json`.

El aggregate modela: `id, workspaceId, startedAt, endedAt, lastActivityAt, idleTimeoutMs`.

Faltan: `intent`, `summary`, `next_seed`, `resumed_from`, `turns_count`, `metadata_json`. Esto bloquea:
- **Capa 7 (Open Questions)** — `docs/04-capas-contexto.md` §3.7 dice explícitamente: "Origen: `sessions` con `ended_at_ms IS NOT NULL`, leyendo `metadata_json.open_questions`". Sin `metadata_json` en el aggregate, la Capa 7 no se puede armar desde el dominio.
- **Resumen rolling de sesión** — `docs/01-arquitectura.md` §2.5: "El 'summary' de la sesion cerrada se genera concatenando los `record_*` acumulados". El curador necesita `summary` y `next_seed` en el aggregate para emitir el rollup.
- **`resumed_from`** — el modelo permite encadenar sesiones (`docs/03-modelo-datos.md` §4.1) pero el aggregate no expone identidad del predecesor.

`recordActivity` además no incrementa `turns_count` ni emite evento (decisión #6 del implementador). La decisión de no emitir evento es defendible para evitar ruido, pero la falta de `turns_count` significa que el curador no podrá detectar sesiones "vacías" (1 actividad, 0 turns) sin volver a SQL.

**Camino sugerido:** agregar al aggregate los campos faltantes. `intent`/`summary`/`nextSeed` pueden ser strings tipados (nuevos VOs `SessionIntent`, `SessionSummary`, `NextSeed`); `metadataJson` puede modelarse como un VO `SessionMetadata` con DU para `openQuestions: readonly OpenQuestion[]`. `turnsCount` puede ser un `UseCount`-like incrementado por `recordActivity` o por un método dedicado `noteTurn(turnId)`.

#### 3. `Entity.description` opcional contradice el schema sin migración propuesta
**Archivos:** `code/src/modules/memory/domain/aggregates/entity.ts:48,232,197-212`, `code/src/modules/memory/domain/value-objects/entity-description.ts:15-36`

La decisión #13 del implementador hace `description: EntityDescription | null` aunque `entities.description TEXT NOT NULL` (`docs/03-modelo-datos.md` §4.5). El JSDoc en `entity.ts:25-32` argumenta que el adapter materializa `''` al persistir y que la nullability en dominio distingue "todavía no sabemos" de "sabemos que está vacío".

El argumento de modelado es razonable, pero hay tres problemas concretos:
1. **`entities_fts` y `searchable_text`** (`docs/03-modelo-datos.md` §4.5 + §5: `name + " " + entity_kind + "\n" + description`). Persistir `''` rompe la búsqueda BM25 sobre descripción y corrompe el snippet del FTS (la columna queda con un blob vacío indistinguible de "descripción legítimamente vacía"). El adapter no puede recuperar el "we don't know yet" del schema.
2. **Sin VO para "no descripción":** la representación elegida es TS-puro `EntityDescription | null`, pero todos los demás opcionales del módulo usan DU explícita (`LastUsed.never|at`, `Scope.project|module`). La inconsistencia es estilística pero significativa: el lineamiento §3 prefiere DU sobre `T | null` ambiguo (también lineamiento 1.6: "Resultado de operaciones que pueden fallar: Result<T,E> o excepciones tipadas. Nunca T | null ambiguo"). Para `lastUsed` se respetó; para `description` no.
3. **`updateDescription(null, ...)` resetea `embeddingStatus`** (decisión #14, `entity.ts:197-212`) — pero re-embebir la cadena `name + " " + kind + "\n" + ""` reembebe lo mismo dos veces (es idempotente por searchable_text). El work del worker se desperdicia. Debería haber una rama: si `description === null`, `embeddingStatus` no se toca.

**Camino sugerido:**
- Reemplazar `EntityDescription | null` por DU `EntityDescriptionState = { kind: "unknown" } | { kind: "known", value: EntityDescription }` (mismo patrón que `LastUsed`).
- En `updateDescription`, sólo invalidar `embeddingStatus` cuando el searchable_text efectivamente cambia (i.e. cuando `state.kind === "known"`).
- Si esto pelea con el adapter SQL, abrir ADR para hacer la columna `NULL`-able (pequeña migración 002, costos casi nulos).

---

### ADVERTENCIAS (no bloquean, corregir antes de cerrar fase)

#### A1. Aggregates: campos `private` sin `readonly` que nunca se reasignan
**Archivos:**
- `decision.ts:53-62` — `title`, `rationale`, `tags`, `confidence`, `scope`, `embeddingStatus` están declarados sin `readonly` pero ninguna mutación las re-asigna (sólo se asignan en constructor, ver grep en `aggregates/decision.ts` líneas 220-253 — ningún `this.title =`).
- `learning.ts:41-48` — `text`, `severity`, `tags`, `confidence`, `scope`, `embeddingStatus` idem.
- `entity.ts:49-54` — `tags`, `confidence`, `scope` idem (description y embeddingStatus sí mutan en `updateDescription`).
- `task.ts:73-78` — `title`, `description`, `priority`, `tags`, `dueAt` idem (sólo `status`, `completedAt`, `updatedAt` mutan).

**Por qué es relevante (R1):** un campo no-`readonly` invita a que un futuro PR introduzca una mutación parcial sin pasar por un método con verbo del negocio. Los aggregates DDD deben hacer estructuralmente imposible esa categoría de bug. El compilador ayuda gratis si se marcan `readonly`.

**Acción:** marcar `readonly` todo lo que no muta. Si en el futuro se quiere una mutación, hay que pensarla deliberadamente (eliminar `readonly` y agregar el método con evento).

#### A2. `Decision.markUsed` permite `markUsed` en superseded — decisión razonable pero bandera amarilla
**Archivo:** `decision.ts:233-253` (decisión #12 del implementador)

El comentario justifica que `include_superseded: true` legítimamente puede surfacear una decision retirada y debe contabilizarse. Es defendible. Pero el `useCount` así contado mezcla "uso vivo" con "uso post-mortem", lo que distorsiona el ranking de la Capa 2 (Project Constitution) que filtra por activas pero usa `use_count` para priorizar. Una decision retirada que se mira mucho podría inflar el ranking de su sucesora (o no, dependiendo de cómo se transfiera).

**Acción:** documentar el comportamiento en `docs/05-memoria-decay.md` (cuando se escriba) o agregar un field separado `usedWhileActive: UseCount` vs `usedAfterSupersede: UseCount`. Mínimo: TODO/ADR para revisar al implementar el ranking.

#### A3. Divergencias de TaskStatus / TaskPriority vs el wire format
**Archivos:** `task-status.ts:10-19` (decisión #4), `task-priority.ts:5-15` (decisión #5)

Las divergencias están bien documentadas en JSDoc (que mencionan que el adapter traduce). Pero:
- **TaskStatus `"todo"` vs API `"pending"`:** el riesgo es que un test E2E de `mem.task.list({filter: {status: "pending"}})` falle silenciosamente si el adapter no traduce. Sugiero reforzar con un test contractual del adapter (fase de QA / integration tests) que se asegure que las traducciones son bidireccionales y exhaustivas.
- **TaskPriority `"critical"`:** el JSDoc dice "API rejects until protocol catches up". Eso significa que un cliente legítimo nunca podrá crear una task `critical` por la tool MCP — sólo internal. Si nadie va a usar `critical` desde fuera, el VO `TaskPriority` no debería listarlo (YAGNI). Si se piensa exponer en v0.5, abrir issue/ADR para actualizar `docs/02-protocolo-mcp.md` §4.5 antes de mergear.

**Acción:** o bien remover `"critical"` del enum del VO (estricto), o bien dejar TODO + issue de roadmap. Misma reflexión para `"todo"` vs `"pending"`: si la traducción es 1:1, el alias es ruido; si hay valor semántico ("in-domain todo es más natural"), justificar más fuerte que con un comentario.

#### A4. `RelationEndpoint` extiende el surface más allá del schema sin ADR
**Archivos:** `relation-endpoint.ts:7-25` (decisión #2), `relation.ts:11-34`

`docs/03-modelo-datos.md` §4.6 modela `relations` como `from_entity_id` / `to_entity_id` (FKs a `entities.id`). El dominio amplía a `decision | learning | entity | task` con un comentario diciendo "el adapter elige cómo persistir". Eso es válido a nivel dominio, pero el adapter tiene problemas concretos:
- Las FKs `REFERENCES entities(id)` quedan inválidas si `from.kind !== "entity"`.
- El `UNIQUE (from_entity_id, to_entity_id, relation)` deja de tener sentido cross-kind.

El JSDoc del aggregate menciona que "una migración futura puede especializar el storage". Entonces, ¿cómo persistirá el adapter SQLite *hoy*? Hay dos caminos viables:
- (a) crear `relations_polymorphic` con `(from_kind, from_id, to_kind, to_id, relation)` y dejar `relations` original sólo para `entity↔entity`.
- (b) ampliar `relations` con columnas `from_kind`, `to_kind` y relajar las FKs (puede romper integridad referencial).

Sin ADR previo el implementador del adapter va a tomar la decisión solo y el dominio quedará desalineado del schema persistido.

**Acción:** abrir ADR (puede vivir junto con `docs/03-modelo-datos.md` §4.6 como nota) que documente cuál de los dos caminos se sigue, antes de Fase 2 (infrastructure). Idealmente: o se restringe el VO a `entity` (estricto al schema actual) y se documenta como roadmap, o se actualiza el schema en una migración 002.

#### A5. `Decision.sessionId` y `Task.sessionId` nullable sin invariante explícita (decisión #10)
**Archivos:** `decision.ts:52,67-101`, `task.ts:72,84-112`

El JSDoc no comenta por qué se hicieron nullable cuando ni `decisions` ni `tasks` tienen `session_id` en el schema (`docs/03-modelo-datos.md` §4.3, §4.7 — no existe esa columna). Si la idea es prepararse para un futuro schema, o capturar la sesión activa al momento del `record`, la motivación debería estar en JSDoc:
- ¿Bajo qué circunstancias `sessionId` es `null`? ¿Decisions creadas vía CLI sin sesión activa?
- ¿El adapter persiste este campo en `metadata_json` o lo descarta?
- Si se descarta, modelarlo en el dominio es código muerto: el siguiente reload via `rehydrate` no lo recupera porque no se guardó.

**Acción:** documentar la motivación en el JSDoc del aggregate, o eliminar el campo si va a ser `null` siempre en el adapter actual.

#### A6. `Task` no emite evento "blocked → todo" via `unblock` distinto de "blocked → in_progress"
**Archivo:** `task.ts:230-249` + `events/task-unblocked.ts:6-13`

El evento `TaskUnblocked` se emite cuando `blocked → todo`, y `TaskStarted` se emite cuando `blocked → in_progress` (vía `start`). Esto es correcto pero el suscriptor de eventos no puede distinguir "tarea desbloqueada y en cola" de "tarea creada limpia → in_progress" mirando solo `TaskStarted`. La diferencia importa para métricas (¿cuánto tiempo estuvo bloqueada?). Mínimo: documentar en `task-started.ts` JSDoc que el evento puede venir de `todo` o de `blocked` y que el consumidor debe correlacionar con eventos previos si necesita el detalle.

**Acción:** ampliar JSDoc de `TaskStarted` o agregar campo `previousStatus: TaskStatus` al payload.

#### A7. `Tags` (shared) — `equals` sensible al orden, semántica posiblemente incorrecta
**Archivo (no del scope, pero usado por todos los aggregates de memory):** `code/src/shared/domain/value-objects/tags.ts:111-119`

El comentario justifica "order matters because tags are part of the user-facing presentation". Pero tags-as-set es la semántica universal en este tipo de modelos (cf. `mem.recall.must_have_tags`, que es claramente set-based). La validación de duplicados ya está implementada (mantiene la unicidad), pero igualar `["a","b"]` ≠ `["b","a"]` rompe equality intuitiva.

**Impacto en memory module:** `Decision.equals` no existe (igualdad por id), pero `Tags.equals` se usa indirectamente cuando un test compara dos aggregates equivalentes. Si la fixture cambia el orden de tags, el aggregate luce "no equal" aunque semánticamente sea idéntico.

**Acción:** revisar con el solid-validator si el order-sensitive equals es intencional. Si no, normalizar a sorted-equals. (Fuera del scope estricto de memory pero afecta sus tests.)

#### A8. `RelationEndpoint.create` no maneja exhaustividad type-safe (control flow)
**Archivo:** `relation-endpoint.ts:81-104`

El método tras validar `isKind(trimmed)` cae a un fallback `return new RelationEndpoint("task", TaskId.from(rawId))` sin un `switch` exhaustivo. Funciona porque `isKind` ya redujo a las cuatro opciones, pero la nueva regla agregada al enum (una hipotética `"workspace"` por ejemplo) caería silenciosamente en el branch `task`. Sugerencia: usar `switch (trimmed)` con `default: throw new Error("unreachable")` para que el compilador exhaustive-check.

**Acción:** convertir el if/else encadenado en switch exhaustivo. Es solo seguridad de evolución, no bug actual.

#### A9. Carpeta `entities/` (DDD) ausente — verificar que es deliberado
**Archivo:** `code/src/modules/memory/domain/` (no hay carpeta `entities/`)

El módulo no tiene entidades DDD puras (todo es aggregate root). Eso es correcto para memory (no hay sub-entidades de un aggregate, salvo discutiblemente "endpoints" de Relation, que aquí están como VO). El template del lineamiento §2 lista `entities/` como subdirectorio, pero su ausencia cuando no hay nada que poner es válida (no se ponen carpetas vacías por simetría). Sugiero un `.keep` o un README de una línea diciendo "no hay entidades sub-aggregate en memory; toda raíz es aggregate" para que el próximo desarrollador no se pregunte si fue olvido.

**Acción:** README o `.keep` documentando la ausencia (opcional).

#### A10. `Session.recordActivity` valida `at.isBefore(...)` pero `Session.end` también — duplicación tolerable
**Archivo:** `session.ts:155-202`

El check anti-no-monotonic está duplicado (líneas 159-165 y 186-192). Es defensa en profundidad razonable, pero un private helper `assertMonotonic(at: Timestamp): void` lo resolvería sin duplicar. Bajo costo, bajo beneficio.

**Acción:** opcional. Si se hace, mantener consistencia con `Task.assertTransitionLegal`.

---

### POSITIVOS (lo que el implementador hizo bien — no necesita cambios)

#### P1. Discriminated Unions usadas con disciplina
`LastUsed` (`never|at`), `Scope` (`project|module`), `RelationEndpoint` (4 kinds), `EmbeddingStatus`, todos siguen el patrón `as const` + DU + `toValue()` que retorna la vista discriminada. Esto es exactly lo que pide el lineamiento §1.6 ("Discriminated unions para variantes"). Decisión #7 (LastUsed) y #8 (Scope) son refactorings positivos sobre `T | null` que merecen ser destacados.

#### P2. Ningún setter público, ninguna mutación de campo público
Cero hits en `grep -rEn "set [a-zA-Z]+\("` y cero hits en `grep -rEn "this\..* =" | grep -v constructor` que no estén dentro de un método de mutación legítimo (con verbo del negocio + emisión de evento). El factor R1 está cumplido sin excepciones.

#### P3. Eventos: 18/18 cumplen el contrato
- Todos `implements DomainEvent` con `eventName: "memory.<kebab-past-tense>"` literal.
- Todos los campos `readonly`.
- Cero copias enteras del aggregate en payload (sólo IDs + datos del hecho).
- Convención naming consistente con `docs/12-lineamientos-arquitectura.md` §1.2 (R6) y con la corrección de Tarea 2 (workspace) que estableció el formato.

#### P4. Aggregates: `pullEvents()` defensivo
Los 7 aggregates implementan `pullEvents()` con la misma pareja de `slice() + length=0 + Object.freeze([])`. Garantía de no-mutación externa, drenado idempotente, contrato uniforme entre roots. Mejor que el baseline que pide el lineamiento.

#### P5. Aggregates: `record()` vs `rehydrate()` separados
Los 7 aggregates tienen factory `record()`/`register()`/`start()`/`create()` que emite evento + factory `rehydrate()` que NO emite. Esto resuelve estructuralmente la trampa común de "rehidratar genera eventos espurios al replay". Cumple R3 (la regla obligatoria de checklist).

#### P6. Errores: tipados, hereditarios, con `jsonRpcCode` opcional
`MemoryDomainError` abstract + 9 concretos. Cada uno con `code: "memory.<error-name>"` estable + `jsonRpcCode: number | null` (decisión heredada de `WorkspaceDomainError`). Sólo `SessionIdleTimeoutExceededError` reclama `JsonRpcErrorCodes.SESSION_EXPIRED` (-32101), que es exactly el caso documentado en `docs/02-protocolo-mcp.md` §6. R5 cumplido.

#### P7. Repositories: nombres del negocio, no genéricos
Cero `findBy(predicate)`. Métodos como `findActiveByTags`, `findActiveByMinimumSeverity`, `findOpenByWorkspace`, `findByNameAndKind`, `findCurrentByWorkspace`, `findFromEndpoint`/`findToEndpoint`. Cada uno con JSDoc que conecta al feature MCP (`mem.recall.must_have_tags`, capa 3, etc.). R4 cumplido.

#### P8. Decisión #1 (Relation como aggregate root) es la decisión correcta
El JSDoc en `relation.ts:11-34` lo argumenta bien: dos endpoints heterogéneos, identidad propia, decay independiente. Modelarlo como hijo de uno de los endpoints sería arbitrario. Confirmo la decisión. La invariante anti-self-loop está custodiada en el factory (línea 89) y no en `rehydrate` (decisión correcta: trust persisted state).

#### P9. Decisión #3 (matriz `ALLOWED_TASK_TRANSITIONS` conservadora) está bien argumentada
`done` terminal + obligatorio pasar por `in_progress` antes de `done` mantiene `started_at_ms`/`completed_at_ms` consistentes para cuando se agregue. La matriz vive en una constante única (single source of truth), las transiciones se chequean con `assertTransitionLegal`. R3 (invariantes en cada mutación) cumplido.

#### P10. Decisión #6 (Session.recordActivity sin evento) está bien argumentada
El JSDoc lo dice: cada actividad real (turn, decision, etc.) ya emite su evento; emitir otro `SessionActivityRecorded` sería ruido. Acepto. La validación de monotonia y idle-timeout sí queda custodiada en `recordActivity`.

#### P11. Imports — solo de `shared/domain/` o de `memory/domain/`
Cero imports de otro módulo (`workspace`, `retrieval`, etc.), cero de `application/`, cero de `infrastructure/`, cero `node:`. Cumple §1.4 estrictamente.

#### P12. Lenguaje del dominio
`Decision`, `Learning`, `Entity`, `Task`, `Turn`, `Session`, `Relation` — todos términos del negocio según `docs/01-arquitectura.md` §3.4 y §6. Cero `Item`, `Record`, `Data`, `Manager`, `Helper`, `Util`, `Service` genérico, `Handler` genérico. Cero prefijos `I`. R7 cumplido.

#### P13. VOs: 28/28 cumplen el contrato R2
- Constructor `private`.
- Factory `static` con nombre del negocio (`from`, `create`, `of`, `at`, `never`, `tip`, `warning`, ...).
- Validación en factory (no en constructor — patrón shared/NonEmptyString).
- Props `readonly`.
- `equals(other)` propio o heredado (los `*Id` heredan de `Id<TBrand>`, los string-VOs heredan de `NonEmptyString`).
- Cero strings/numbers crudos donde hay significado de negocio.

---

## Verificación contra el checklist obligatorio

| # | Check | Verdict | Notas |
|---|---|---|---|
| 1 | VOs inmutables, validan en factory, readonly props, equals, constructor privado | OK | 28/28 |
| 2 | Aggregates: identidad, invariantes en CADA mutación, métodos de negocio, eventos, `pullEvents()`, `rehydrate()` no emite | OK con advertencias | A1 (campos sin readonly), A2 (markUsed en superseded), A6 (TaskStarted ambiguo) |
| 3 | Eventos past-tense kebab, inmutables, `eventName` literal | OK | 18/18 |
| 4 | Repositorios trabajan con aggregate completo, queries con nombres de negocio | OK | 7/7 |
| 5 | Errores tipados, extienden `MemoryDomainError`/`DomainError`, código JSON-RPC apropiado | OK | 9/9 + 1 abstract |
| 6 | Lenguaje del dominio | OK | Todos los nombres alineados con docs |
| 7 | Coherencia con docs/03 §4: campos cubiertos, divergencias documentadas y razonables | RECHAZADO | Crítico #1 (Turn faltante 9 + sobrante 2), Crítico #2 (Session faltante 6), Crítico #3 (Entity.description nullable inconsistente con DU patrón) |
| 8 | Imports sólo desde shared/domain/ con paths relativos | OK | Cero violaciones |
| 9 | Relation aggregate, no self-loop | OK | Decisión correcta + invariante en factory |
| 10 | Transiciones Task + Session lifecycle | OK | Matrices y monotonia bien custodiadas |
| 11 | Convención `eventName` `"memory.<kebab-past-tense>"` | OK | 18/18 |
| 12 | Cobertura semántica para 7 capas del bundle de contexto | RECHAZADO (parcial) | Capa 4 (Recent Turns) y Capa 7 (Open Questions) bloqueadas por críticos #1 y #2 |

---

## Veredicto justificado

**RECHAZADO.** Tres hallazgos críticos bloquean aprobación:

1. `Turn` no modela 9 campos del schema documentado e introduce 2 nuevos sin justificación documental — bloquea Capas 4 y 5 del bundle de contexto.
2. `Session` no modela 6 campos del schema documentado, incluyendo `metadata_json` que `docs/04-capas-contexto.md` §3.7 declara como fuente directa de la Capa 7.
3. `Entity.description` nullable es inconsistente con el patrón DU adoptado en el resto del módulo y crea problemas concretos en `entities_fts` y en `updateDescription` (re-embed redundante).

El resto del módulo es de calidad alta: cero imports prohibidos, cero setters, eventos correctos, errores correctos, repos correctos, VOs correctos. Las decisiones #1 (Relation como aggregate), #3 (matriz Task), #6 (Session sin evento), #7 (LastUsed DU), #8 (Scope DU) están bien argumentadas y se mantienen.

Las advertencias A1-A10 deberían atenderse antes de cerrar Fase 1 pero no bloquean aprobación individual; se recomienda revisarlas en el ciclo de corrección de los críticos.

---

## Próximo paso

Devolver al `domain-architect` con instrucciones específicas:

1. **Crítico #1 (Turn):** decidir entre conformar al schema (agregar los 9 campos) o abrir ADR para mutar el schema. Mi recomendación: conformar al schema, eliminar `actor`/`tokens` o moverlos a `metadata_json`.
2. **Crítico #2 (Session):** agregar `intent`, `summary`, `nextSeed`, `resumedFrom`, `turnsCount`, `metadata` (con DU para `openQuestions`) al aggregate. Sin esto la Capa 7 del bundle no se puede armar.
3. **Crítico #3 (Entity.description):** convertir a DU `EntityDescriptionState = unknown | known`, ajustar `updateDescription` para no resetear embedding cuando state es `unknown`. Alternativamente abrir ADR para hacer la columna SQL nullable.

Tras corrección, re-validar este audit (cycle-1). Si los críticos están atendidos y al menos A1 (readonly) y A4 (Relation ADR) están resueltos, el verdict será APROBADO.
