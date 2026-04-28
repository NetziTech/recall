# DDD Validation — Phase 1, Task 7: cli/domain
**Validator:** ddd-validator
**Phase:** phase-1-domain (cli module — thin domain, ring-buffered history)
**Scope:** `code/src/modules/cli/domain/` (12 archivos: 1 aggregate, 5 VOs, 1 event, 4 errors, 1 repository)
**Date:** 2026-04-27
**Verdict:** RECHAZADO

Hallazgo bloqueante único: el catálogo `COMMAND_NAMES` introduce dos comandos (`lock` y `status`) que NO están documentados en `docs/07-instalacion.md` §7 ni en ninguna otra sección de la documentación. El catálogo es la "single source of truth" del público contrato `mcp-memoria <command>`; cualquier divergencia con la doc es una bandera dura del lineamiento de Ubiquitous Language (`docs/12-lineamientos-arquitectura.md` §1.2: "El lenguaje del dominio es el del negocio … nombres reflejan el negocio"). El detalle del implementador dice textualmente "cubre docs/07-instalacion.md §7 + alias `status`" pero (a) no menciona `lock` en absoluto y (b) `status` aparece en el código como entrada *propia* del catálogo, NO como alias de `stats` (no hay mecanismo de alias en `CommandName.create`). Detalle abajo.

El resto del módulo es DDD-correcto y de muy alta calidad: 5 VOs con `private constructor` + factory + `equals()` + invariantes en construcción, `CommandHistory` con identidad inmutable (`WorkspaceId`), mutación única `recordExecution(...)` que custodia la invariante de orden monotónico (`endedAt` no decreciente) y emite `CommandExecuted` exactamente una vez, repositorio que trabaja sólo con el agregado completo (sin `findBy(predicate)` genérico), eventos en past-tense kebab (`"cli.command-executed"`), 4 errores tipados con `code` estable y `jsonRpcCode = null` justificado, y cero imports fuera de `shared/domain/` (ni de otros módulos). Las decisiones #1-#10 del implementador están todas defendidas con docstrings sustantivos y son DDD-coherentes (ver detalle por checklist abajo).

---

## Hallazgos

### CRÍTICOS (bloquean aprobación)

#### 1. `CommandName` catálogo — comandos sin respaldo documental
**Archivo:** `code/src/modules/cli/domain/value-objects/command-name.ts:21-52`
**Regla violada:** R7 (Ubiquitous Language) y `docs/12-lineamientos-arquitectura.md` §1.2 ("nombres reflejan el negocio") + §3.3 ("Lenguaje del dominio").

`docs/07-instalacion.md` §7 enumera exactamente 20 comandos:
`init, mode, unlock, forget-key, export-key, rekey, add-key, audit, sanitize, curator-run, curator-log, import-handoff, export, import, wipe, install-hook, uninstall-hook, stats, health, server`.

El catálogo entregado declara 22 entradas: las 20 documentadas más `lock` (línea 28) y `status` (línea 49). Verificación cruzada en toda la documentación:

```
$ grep -rn "mcp-memoria \(lock\|status\)" docs/
(sin resultados — sólo aparece `unlock`, jamás `lock`; sólo aparece `status` como literal de campo en `13-workflow-agentes.md`, no como comando CLI)
```

Problemas concretos:

1. **`lock`** — el lineamiento de seguridad usa `forget-key` (`docs/11-seguridad-modos.md:157`: `mcp-memoria forget-key --workspace <path>`) como inverso de `unlock`. El comentario del catálogo (`command-name.ts:25` "Encryption key lifecycle") agrupa `lock` con la familia de claves, pero ni `docs/07-instalacion.md` §7, ni `docs/11-seguridad-modos.md` §6, ni el roadmap (`docs/09-roadmap.md`) mencionan `lock`. Si el implementador *quiere* introducir `lock` como sinónimo de `forget-key`, eso es un cambio de Ubiquitous Language que requiere ADR + actualización de doc, no una entrada silenciosa en el catálogo de la SSOT.
2. **`status`** — el detalle del implementador dice "alias `status`", pero el código NO implementa un alias (no hay tabla `ALIASES`, no hay normalización en `create(...)`). `CommandName.create("status")` devolverá un `CommandName` cuyo `value` es `"status"`, indistinguible de un comando propio. La capa application no tiene cómo resolver `status` → `stats`: cuando despache, deberá hacer `if (name.value === "status") dispatchStats(...)`, lo cual rompe el principio del catálogo (que es justamente *una sola fuente de verdad nombrada*). O bien `status` es un comando propio y debe documentarse en §7, o bien es un alias y debe modelarse explícitamente (ej. `CommandName.create("status")` retorna `CommandName("stats")` y el catálogo expone `aliases: { status: "stats" }`).

Impacto: el `--help` generado por `CommandName.all()` (línea 126) listará `lock` y `status` como comandos de primera clase, contradiciendo lo que la doc le dice al usuario. La promesa del docstring ("removing or renaming an entry is a breaking change for end users and for any documentation that references the command") se rompe en la dirección opuesta: *agregar* uno sin documentación también lo es, porque crea un contrato implícito que nadie ratificó.

**Camino sugerido (decisión del orquestador):**
1. **Conformar al doc:** quitar `lock` y `status` del catálogo. Si la application layer quiere ofrecer `status` como alias de `stats`, modelarlo como tabla de aliases separada (ej. `COMMAND_ALIASES: Record<string, CommandNameValue>`) que viva fuera del set canónico, con normalización explícita en `CommandName.create(...)`.
2. **Modificar el doc:** actualizar `docs/07-instalacion.md` §7 para incluir `lock` y `status` (con su sintaxis, opciones y propósito). Si `status` *es* un alias, documentarlo como tal en §7 ("`status` — alias of `stats`") y modelarlo en código vía la tabla de aliases del punto 1, NO como entrada propia del catálogo.

Sin alguna de las dos vías, el catálogo deja de ser SSOT del producto.

---

### NO BLOQUEANTES (pueden quedar para un follow-up, no impiden aprobar)

#### 2. `command-history.ts` — referencia documental inexacta
**Archivo:** `code/src/modules/cli/domain/aggregates/command-history.ts:21-23`

El docstring cita `docs/03-modelo-datos.md` §10 "audit_log", pero la sección real es §4.8 ("Tabla `audit_log`"). §10 no existe en ese documento. Es solo drift de comentario, no afecta el modelo. Corregir a "§4.8".

#### 3. `CommandExecution.equals` no se invoca en ninguna invariante
**Archivo:** `code/src/modules/cli/domain/value-objects/command-execution.ts:93-101`

El método `equals(...)` está bien implementado (componente a componente), pero hoy nadie en el dominio lo llama (la igualdad de aggregates `CommandHistory.equals` usa identidad por `workspaceId`, y la repositorio no compara executions). Es defensa correcta del contrato VO; sólo dejar nota para que el SOLID/QA validator no lo marque como código muerto.

---

## Checklist DDD — detalle

### R1/R2 — VOs (5 archivos)

| VO | `private constructor` | factory | props `readonly` | `equals` | invariantes | Veredicto |
|---|:---:|:---:|:---:|:---:|:---:|---|
| `CommandName` | ✓ (línea 85) | `create`, `all`, `isValue` | ✓ | ✓ | catalog membership + trim + case sensitive (línea 97-104) | OK |
| `CommandArgs` | ✓ (línea 46) | `of`, `empty` | ✓ (`payload` private readonly) | ✓ por reference (justificado, ver abajo) | N/A (opaque) | OK |
| `ExitCode` | ✓ (línea 99) | `from`, `fromValue`, `success` | ✓ | ✓ | POSIX 0..255 + integer (línea 121-126) | OK |
| `CommandOutput` | ✓ (línea 36) | `create`, `empty`, `stdoutOnly`, `failure` + builders `with*` | ✓ | ✓ | delega validación a componentes | OK |
| `CommandExecution` | ✓ (línea 38) | `create` | ✓ | ✓ | `endedAt >= startedAt` (línea 59-66) | OK |

**`CommandArgs` reference equality** — justificada y documentada explícitamente (líneas 38-44: "the domain has no schema to compare against, so a structural comparison would either be unreliable or require a serialiser"). El argumento es honesto: el dominio CLI declara que el shape de args es opaco y que el parsing tipado vive en application layer (decisión #2 del implementador, alineada con `docs/12-lineamientos-arquitectura.md` §1.6 sobre `unknown` + Zod). Aceptado.

**Builder `with*` semantics replace-not-append** (`command-output.ts:80-101`) — bien documentado: el comentario de línea 87-89 explica el por qué (evitar O(n²) y leak de buffer mechanics). Aceptado.

**`ExitCode.fromValue(n)` escape hatch** — defendible para reenviar exit codes de subprocesos (decisión #3). El contrato `kind: ExitCodeKind | null` es la representación correcta del "no hay nombre semántico para este número". El mapping JSON-RPC en doc (lineas 19-27) es exacto contra `JsonRpcErrorCodes`. Aceptado.

### R3 — Aggregate `CommandHistory`

| Criterio | Verificación | Resultado |
|---|---|---|
| Una raíz | sí, único agregado del módulo | OK |
| Identidad explícita | `WorkspaceId` (VO con brand, no string) | OK |
| `private constructor` + factories | `private constructor` (línea 76) + `empty`, `rehydrate` | OK |
| Mutaciones por verbos del negocio | `recordExecution(...)` (línea 163) — único punto de mutación | OK |
| Invariantes garantizadas | `assertCapacity` (línea 274), monotonic-time check en `rehydrate` (línea 133) y en `recordExecution` (línea 165), capacity bound `≤ MAX_CAPACITY=1000` | OK |
| `pullEvents()` | sí (línea 250), drena buffer, devuelve `Object.freeze` | OK |
| Igualdad por id | sí (línea 262, sólo `workspaceId.equals`) | OK |
| Sin setters | confirmado (`grep -E "set [A-Z]" returned nothing) | OK |
| Sin asignaciones fuera de constructor | confirmado: las 4 asignaciones son `recordExecution` push/shift/events.push (mutaciones internas legítimas) y `pullEvents` `events.length = 0` (drena) | OK |

**Decisión #6 (identidad = WorkspaceId, no id propio):** correctísima. El docstring (líneas 51-55) lo justifica: "One `CommandHistory` per `WorkspaceId`. The workspace is the only meaningful scope for 'recent commands'". No hace falta un id sintético adicional; el agregado existe como vista 1:1 del workspace, y el repo está keyed por `WorkspaceId` (`command-history-repository.ts:45`). Coherente con `Decision`/`Learning` que también usan `WorkspaceId` como scope (no como identidad propia, pero el patrón de "un agregado por workspace" es válido cuando el dominio lo justifica — aquí sí, el ring buffer no tiene sentido cross-workspace).

**Ring buffer DDD-coherente:** sí. El docstring (líneas 31-49) defiende el modelo en tres puntos sustantivos (1) producto necesita "what did the user run recently?", (2) la invariante de orden monotónico no es enforce-able por SQL ORDER BY en el write path, (3) centraliza emisión de evento. Los tres argumentos son técnicamente correctos. La capacidad por defecto de 50 y el techo duro de 1000 (con la nota de que más allá es trabajo de un audit module dedicado, no del CLI domain) demarcan bien el bounded context.

**`recordExecution` custodia la invariante de orden monotónico:** sí, línea 165-172. Lanza `InvariantViolationError` con `invariant: "cli.command-history.monotonic-time"` ante out-of-order. La eviction FIFO (`shift()`) es O(n) sobre buffer pequeño con tope de 1000, justificada en el comentario línea 175-178 (la alternativa circular index leak mechanics).

**`recentExecutions(limit?)`:** validación defensiva del input vía `InvalidInputError` (línea 209-214); devuelve `Object.freeze` shallow copy. Apropiado.

### R4 — Repositorio `CommandHistoryRepository`

| Criterio | Verificación | Resultado |
|---|---|---|
| Interface en `domain/repositories/` | sí | OK |
| Trabaja con aggregate completo | sí (`CommandHistory`, no `CommandExecution` suelto) | OK |
| Métodos del negocio (no `findBy(predicate)` genérico) | `findById`, `save`, `delete` — tres exactos | OK |
| `Promise<>` en todos | sí (líneas 45, 51, 56) | OK |
| `findById` retorna `null` si ausente | sí, contrato explícito (línea 22) | OK |

**`delete(id)` y eventos pendientes:** la pregunta del checklist es válida ("si se borra history, ¿qué pasa con eventos emitidos?"). Hoy el contrato del repositorio dice "no-op cuando nada estaba almacenado" (línea 31, 56) pero NO dice qué hacer con un agregado en memoria que tenga eventos sin drenar. Sin embargo:

- Los eventos son drenados por la application layer vía `pullEvents()` *antes* de pasar al repositorio (patrón estándar de este codebase, ver `Decision` en memory module). `delete` lo invoca el caso de uso `WipeWorkspace` (`docs/07-instalacion.md:346` `mcp-memoria wipe`), que no necesita emitir eventos del propio history (la decisión semántica de "este workspace fue wipe-ado" es del workspace aggregate, no del history).
- El history mismo NO emite un evento "CommandHistoryDeleted" — coherente porque no hay subscriber natural para esa señal: el audit log ya tiene los `CommandExecuted` históricos, y el wipe es responsabilidad del workspace.

Aceptable. Si el orquestador quisiera ser explícito, una mejora menor sería agregar al contrato del repo: "`delete(id)` no dispara eventos de dominio; el caller es responsable de emitir el evento de scope superior si lo necesita". No bloqueante.

### R6 — Evento `CommandExecuted`

| Criterio | Verificación | Resultado |
|---|---|---|
| Implementa `DomainEvent` | sí (línea 32) | OK |
| Past tense | sí, "Executed" (no "Execute" / "Executing") | OK |
| Naming `module.event-kebab` | `"cli.command-executed"` (línea 33) — alineado con la convención del marker interface (`domain-event.ts:23-25`) | OK |
| Props `readonly` | sí (líneas 33-36) | OK |
| Solo datos del hecho | lleva `workspaceId`, `execution` (VO completo), `occurredAt` — sin copia del aggregate | OK |
| `occurredAt === execution.endedAt` | invariante del docstring (líneas 24-27); el aggregate lo garantiza al llamar `new CommandExecuted({..., occurredAt: execution.endedAt})` (línea 184) | OK |
| Inmutable post-construcción | sí (props `readonly`, no setters) | OK |

Llevar el `CommandExecution` VO completo dentro del evento es la decisión correcta: el VO ya es inmutable y self-describing, y los subscribers (audit log, telemetría) no tienen que round-trip al repositorio para enriquecer el log. Coherente con cómo `DecisionRecorded` lleva los componentes de la decisión.

### R5 — Servicios de dominio

Cero. Decisión #7 del implementador: "no hay operación cross-aggregate; resolver argv → use case es application". Correcto: el CLI domain no tiene otros agregados con los que coordinar, y la resolución de argv → casos de uso es naturalmente application layer (es donde vive el dispatcher de commander.js / yargs). Aceptado.

### R7 — Lenguaje del dominio

```
$ grep -rEi "(class|interface|type) [A-Z][a-zA-Z]*(Item|Record|Manager|Helper|Util|Handler)" cli/domain/
(sin resultados)
```

Nombres limpios: `CommandName`, `CommandArgs`, `CommandOutput`, `ExitCode`, `CommandExecution`, `CommandHistory`, `CommandExecuted`, `CommandHistoryRepository`, `UnknownCommandError`, `InvalidCommandArgsError`, `InvalidExitCodeError`, `CliDomainError`. Todos hablan del dominio CLI; ningún `Item`/`Manager`/`Handler` genérico. El único matiz es el del Hallazgo #1 (las entradas `lock` y `status` del catálogo, no la nomenclatura del modelo en sí).

### Imports cross-módulo

```
$ grep -rE "^import" cli/domain/ | grep -v "from \"\.\." | grep -v "from \"\."
(sin resultados — todos los imports son ../../../../shared/... o ./../...)
```

Cero imports a otros módulos. Toda la dependencia externa es a `shared/domain/` (`Timestamp`, `WorkspaceId`, `DomainEvent`, `DomainError`, `InvalidInputError`, `InvariantViolationError`). Coherente con `docs/12-lineamientos-arquitectura.md` §1.5 Regla 2.

### Errores

| Error | Hereda | `code` estable | `jsonRpcCode` | Veredicto |
|---|---|---|:---:|---|
| `CliDomainError` (abstract) | `DomainError` | abstract | abstract | OK (justificado en docstring 1-36 por qué es siempre `null`) |
| `UnknownCommandError` | `CliDomainError` | `cli.unknown-command` | `null` | OK |
| `InvalidExitCodeError` | `CliDomainError` | `cli.invalid-exit-code` | `null` | OK |
| `InvalidCommandArgsError` | `CliDomainError` | `cli.invalid-command-args` | `null` | OK |

**Decisión #9 (`jsonRpcCode = null` siempre):** correctamente argumentada (`cli-domain-error.ts:6-36`): el CLI surface no es JSON-RPC, los errores se traducen a `process.exit(code)` + mensaje en `stderr`. Mantener el campo para uniformidad con el contrato base de `DomainError` cross-módulo.

**Decisión #10 (`InvalidCommandArgsError.commandName: string`, no VO):** correctamente argumentada (`invalid-command-args-error.ts:13-22`): el parser puede fallar antes de instanciar el `CommandName` VO; obligar al callsite a tener un VO sería un gallina-y-huevo. Aceptado.

---

## Resumen ejecutivo

- **VOs:** 5/5 conformes (incluido `CommandArgs` con reference equality justificada y `ExitCode` con catalog + escape hatch POSIX).
- **Aggregate:** `CommandHistory` correctamente modelado — identidad WorkspaceId apropiada, ring buffer DDD-coherente, invariante de orden monotónico custodiada en `recordExecution` y `rehydrate`, eventos drenables por `pullEvents()`.
- **Repositorio:** 3 métodos del negocio, agregado completo, sin queries ad-hoc.
- **Eventos:** `CommandExecuted` past tense, kebab, módulo-prefixed, payload self-describing.
- **Servicios:** ninguno (correcto, no hay operación cross-aggregate).
- **Errores:** 4 tipados con `code` estable + `jsonRpcCode = null` justificado.
- **Imports:** cero cross-módulo.

**Único bloqueante:** catálogo `CommandName` con 2 entradas (`lock`, `status`) sin respaldo en `docs/07-instalacion.md` §7. Para aprobar:
- conformar al doc (quitar las 2 entradas y, si se quiere `status`, modelarlo como alias separado), **o**
- abrir ADR + actualizar `docs/07-instalacion.md` §7 con la sintaxis y propósito de `lock` y `status`.

Una vez resuelto el Hallazgo #1, el módulo CLI puede aprobar DDD sin más ciclos. Los hallazgos #2 y #3 son no-bloqueantes y pueden tratarse en follow-up.
