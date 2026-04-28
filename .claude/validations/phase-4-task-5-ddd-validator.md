# DDD Validator — Phase 4 Task 5 (memory/application + memory/infrastructure)

**Validator**: ddd-validator
**Phase**: phase-4-task-5
**Scope**: `code/src/modules/memory/application/` and `code/src/modules/memory/infrastructure/`
**Reference**: `docs/12-lineamientos-arquitectura.md` §1.2; `docs/01-arquitectura.md` §2.5; `docs/03-modelo-datos.md` §4; `docs/04-capas-contexto.md`.

---

## A. Lenguaje del dominio (R7)

**PASS.**

- Use cases con verbos de negocio (`record-decision`, `record-learning`, `record-entity`, `record-relation`, `record-turn`, `track-task`, `start-session`, `end-session`, `audit-memory`, `export-memory`, `import-memory`, `import-handoff`, `stats-memory`, `wipe-memory`).
- Adapters reflejan puerto + tecnología: `SqliteDecisionRepository`, `SqliteEntityRepository`, `SqliteLearningRepository`, `SqliteRelationRepository`, `SqliteSessionRepository`, `SqliteTaskRepository`, `SqliteTurnRepository`, `SqliteMemorySnapshotReader`, `SqliteMemoryStatsReader`, `SqliteMemoryWiper`, `SqliteEmbeddingEnqueuer`, `JsonMemoryExporter`, `JsonMemoryImporter`, `MarkdownHandoffParser`.
- Cero clases con sufijos prohibidos `Manager`, `Util`, `Data`, `Item`, `Object`, `Record`. La unica clase con sufijo `Helper` es `SessionContextHelper` (`application/use-cases/session-context-helper.ts`); su JSDoc justifica el rol como colaborador interno del implicit-session policy y el nombre captura un concepto de dominio (la "sesion implicita" del §2.5). Se acepta — no es un `*Helper` generico.
- Cero interfaces con prefijo `I`. Los puertos usan nombres-verbo (`RecordDecision`, `TrackTask`, `EmbeddingEnqueuer`, `MemoryExporter`).

## B. Use cases con aggregates / VOs

**PASS.**

- Inputs/outputs usan VOs del dominio: `WorkspaceId`, `Tags`, `Confidence`, `SessionId`, `DecisionId`, `LearningId`, `EntityId`, `TaskId`, `TurnId`, `RelationId`, `Scope`, `EntityKind`, `LearningSeverity`, `TaskPriority`, `TaskStatus`, `Timestamp`, `RelationEndpoint`, etc.
- Primitivos (`string`, `number`) solo en la frontera de I/O (titulos, rationales, `dueAtMs`, `markdown`, `json`); cada use case envuelve via factory del dominio (`Title.from(...)`, `Timestamp.fromEpochMs(...)`) antes de tocar el aggregate.
- Aggregates se mutan via metodos del propio aggregate (`task.start`, `task.block`, `task.unblock`, `task.complete`, `session.recordActivity`, `session.end`, `decision.pullEvents`). NINGUN use case asigna campos privados ni invoca setters.

## C. Repositorios reconstruyen aggregates

**PASS.**

- `SqliteDecisionRepository.parseRow` valida el row con `DecisionRowSchema` (Zod) y luego invoca `Decision.rehydrate(...)` con VOs (`DecisionId.from`, `DecisionTitle.from`, `Rationale.from`, `Tags.create`, `LastUsed.at`, etc.).
- Mismo patron en `SqliteLearningRepository`, `SqliteEntityRepository`, `SqliteTaskRepository`, `SqliteTurnRepository`, `SqliteSessionRepository`, `SqliteRelationRepository`.
- Ningun adapter retorna DTOs primitivos. Las firmas devuelven `Promise<Decision | null>`, `Promise<readonly Task[]>`, etc.
- Workspace scoping correcto: cada adapter recibe el `WorkspaceId` por constructor (la DB ES el workspace per docs/03 §4.1) y valida via `assertWorkspace(...)` antes de cada query.

## D. Sesion implicita (docs/01 §2.5)

**PASS.**

- `SessionContextHelper.acquire(...)` materializa la politica "30 min idle → rotate":
  1. Lee la sesion actual.
  2. Si no es idle, la retorna.
  3. Si es idle, llama `current.end({ occurredAt: now })`, persiste, publica `SessionEnded`.
  4. Crea una fresh con `Session.start(...)` (linkando `resumedFrom`), persiste, publica `SessionStarted`.
- `RecordTurnUseCase.record(...)` invoca el helper en cada turno (linea 66) → cumple la auto-rotation documentada en `docs/01 §2.5` y reflejada en `record-turn.port.ts` JSDoc.
- `TrackTaskUseCase.create(...)` invoca `sessionHelper.findActive(...)` (linea 69) — find sin rotate, consistente con el JSDoc del puerto que dice "task lifecycle is independent of conversation sessions".
- `StartSessionUseCase` duplica la logica deliberadamente (con su propio JSDoc justificando) — es el caso de uso publico para forzar rotacion eager; no rompe DDD.

## E. Eventos (R6)

**PASS.**

- Cero `new XxxEvent(...)` en application/infrastructure (`grep` confirma).
- Cero `extends DomainEvent` fuera de `domain/events/`.
- Todos los use cases drenan via `aggregate.pullEvents()` y publican via `EventPublisher.publishAll(...)`. 16 ocurrencias verificadas (record-decision, record-entity, record-learning, record-turn, record-relation, start-session, end-session, track-task, session-context-helper, etc.).
- `ImportHandoffUseCase` y `ImportMemoryUseCase` llaman `pullEvents()` para vaciar el buffer pero NO publican — JSDoc justifica: "an import is a state restoration, not a stream of new business facts" — coherente con DDD (los eventos representan hechos del negocio en su momento original, no la rehidratacion).

## F. TrackTaskUseCase

**PASS** (con observacion sobre la descripcion del orchestrator).

El orchestrator menciono "5 sub-actions: create, update-status, advance-step, attach-decision, attach-context". La implementacion REAL expone create/start/block/unblock/complete + list, que se alinean exactamente con `docs/02-protocolo-mcp.md` §4.5 y con la maquina de estados del aggregate `Task` (`docs/03-modelo-datos.md` §4.7). La descripcion del orchestrator es imprecisa; la implementacion es correcta:

- `create(...)` → `Task.create(...)` (TaskCreated, status=todo).
- `start(...)` → `task.start({ occurredAt })` (TaskStarted, todo|blocked → in_progress).
- `block(...)` → `task.block(...)` (TaskBlocked).
- `unblock(...)` → `task.unblock(...)` (TaskUnblocked).
- `complete(...)` → `task.complete(...)` (TaskCompleted, pin completedAt).
- `list(...)` → query (no event).

Cada metodo carga el aggregate, aplica un mutator que invoca el metodo del aggregate (NO setters), persiste, drena eventos, retorna `(previousStatus, currentStatus)`. La maquina de transiciones vive dentro del aggregate (`ALLOWED_TASK_TRANSITIONS`). El use case NO valida transiciones — delega al aggregate, que tira `InvalidTaskTransitionError`. Correcto.

No hay discriminated-union de inputs (cada accion es un metodo separado en el puerto `TrackTask`); JSDoc lo justifica via SOLID-SRP (overlap de dependencias). Aceptable.

## G. Import / Export

**PASS.**

- `JsonMemoryExporter` (`infrastructure/import-export/json-memory-exporter.ts`): toma aggregates del dominio y los serializa via getters (`d.getId().toString()`, `d.getTitle().toString()`, `d.getTags().toArray()`); preserva la estructura semantica de cada VO. `JSON.stringify` con `null, 2` produce salida estable.
- `JsonMemoryImporter` (`infrastructure/import-export/json-memory-importer.ts`): valida el envelope con `EnvelopeSchema` (Zod) y cada row con su schema dedicado (`DecisionSchema`, `LearningSchema`, ...). Reconstruye via factories `*.rehydrate(...)` con VOs (`DecisionId.from`, `Tags.create`, `Confidence.of`, `LastUsed.at`, etc.). Re-pina `workspaceId` para soportar cross-workspace imports.
- `MarkdownHandoffParser` (`infrastructure/import-export/markdown-handoff-parser.ts`): heuristico por seccion (headings regex), bullets/tablas; decisiones extraidas con `confidence = 0.9` per JSDoc — cumple "decisiones extraidas con `confidence < 1.0`". Learnings y tasks con severidad/prioridad heuristica. `skipped` array para reconciliacion manual. Falla con `MemoryInfrastructureError.handoffParseFailed(...)`.

## H. Audit / Stats / Wipe

**PASS.**

- `AuditMemoryUseCase` corre 3 chequeos de consistencia (decisions con `superseded_by` huerfano, learnings con `consolidated_into` huerfano, relations con endpoint inexistente), retorna `AuditIssue[]` tipados con `severity`, `code`, `message`, `entryRef`. Read-only, no muta. Logger `warn` cuando hay issues. Correcto.
- `StatsMemoryUseCase` delega al puerto `MemoryStatsReader.read(...)`. Log `debug`. Correcto.
- `WipeMemoryUseCase` delega al puerto `MemoryWiper.wipe(...)`. El adapter `SqliteMemoryWiper` envuelve los `DELETE FROM` en `db.transaction(...)` (atomico per JSDoc). Borra tablas en orden (children primero) — cumple "DELETE atomico, transaccional".

## I. Errores tipados

**PASS.**

- `MemoryApplicationError` (codigos `memory.no-active-session`, `memory.task-not-found`, `memory.entity-already-exists`, `memory.relation-endpoint-missing`, `memory.import-validation-failed`, ...) — semantica de precondicion / orquestacion. `private constructor` + factories estaticas. Hereda de `Error`, NO de `DomainError` (JSDoc justifica: "no-active-session" no es invariante de un aggregate).
- `MemoryInfrastructureError` (codigos `memory.persistence.row-malformed`, `memory.persistence.upsert-failed`, `memory.persistence.query-failed`, `memory.embedding.enqueue-failed`, `memory.import.parse-failed`, `memory.export.serialize-failed`, `memory.handoff.parse-failed`) — semantica operacional. Hereda de `InfrastructureError` shared. `private constructor` + factories. `cause` no enumerable.
- Cero `throw new Error(...)` directos en los archivos auditados.

## J. Schema mismatch (`pending` vs `todo`) — DISPUTE

**Hallazgo no critico** pero levantado como dispute formal per instrucciones del orchestrator.

`code/migrations/004__core-memory-schema.sql:317` declara `status TEXT NOT NULL DEFAULT 'pending'` para la tabla `tasks`. `docs/03-modelo-datos.md` §4.7 (linea 334) documenta el mismo default `'pending'`. El dominio (`memory/domain/value-objects/task-status.ts`) acepta solo `todo | in_progress | blocked | done`. El adapter `SqliteTaskRepository.normaliseStatus(...)` mapea `'pending' → todo` al leer (linea 232).

**Por que es dispute, no critico de Tarea 4.5**:
- La tarea 4.5 audita app/infra. La normalizacion en el adapter es la respuesta correcta a un schema/dominio gap heredado.
- La inconsistencia real esta entre `docs/03 §4.7` + migracion 004 (que dicen `'pending'`) y el dominio (Tarea 4.1, ya validado, que decidio `'todo'`).
- El orchestrator pide que se reporte como dispute si la migracion declara `'pending'` y el dominio usa `'todo'`. Confirmado: si.

**Recomendacion al orchestrator** (NO implementar en Tarea 4.5): elevar al data-modeler en Fase 1.5 / Fase 4 cleanup para una de dos vias:
1. Cambiar el default SQL de `'pending'` → `'todo'` en una nueva migracion (005) y actualizar `docs/03-modelo-datos.md` §4.7.
2. Aceptar formalmente la asimetria como contrato (legacy rows pueden traer `'pending'`; nuevos writes nunca producen `'pending'`) y documentar el mapping en docs/03.

La normalizacion en `sqlite-task-repository.ts:226-234` no oculta el gap — esta documentada explicitamente con JSDoc al inicio de la clase. El codigo de Tarea 4.5 es correcto dado el constraint heredado.

---

## Validacion adicional

- **Setters publicos en app/infra**: cero (`grep -rE "set [a-zA-Z]+\("` retorna vacio).
- **Construccion de domain events fuera de domain**: cero.
- **Cross-module imports** (memory → curator, memory → retrieval, etc.): cero. Solo se usa `shared/`.
- **Dependency direction**: aplicacion depende del dominio + shared/application/ports; infraestructura implementa puertos definidos en application; ningun import del estilo `infrastructure → presentation` o `domain → application`.

---

# Veredicto

**APPROVED**

Cero violaciones criticas a R1-R7 en `memory/application/` y `memory/infrastructure/`. El use de aggregates, VOs, factories, ports y eventos es coherente con DDD/Hexagonal. La sesion implicita esta materializada en `SessionContextHelper` per `docs/01 §2.5`. Los adapters reconstruyen aggregates completos via Zod + factories. Errores tipados y diferenciados (application vs infrastructure).

**Una dispute formal** sobre el schema-mismatch `pending` vs `todo` (migracion 004 / docs/03 §4.7 vs domain `TaskStatus`). El codigo de la Tarea 4.5 lo maneja correctamente con normalizacion documentada — no bloquea APPROVED — pero requiere resolucion en otra fase (data-modeler).
