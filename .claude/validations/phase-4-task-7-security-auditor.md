# Security Auditor — Fase 4 Tarea 4.7

**Validador**: security-auditor
**Tarea**: 4.7 — Re-wiring del Composition Root
**Fecha**: 2026-04-27
**Veredicto**: APPROVED

---

## Resumen ejecutivo

Auditoría de la propagación de la passphrase desde la capa CLI hacia el
módulo `encryption` a través del composition root, más la verificación
de seguridad de los 6 facades CLI nuevos, los 4 nuevos adapters MCP, el
event-bus publisher, y el wiring completo. CERO violaciones críticas
(A02 / A03 / A07). El código respeta la disciplina de redacción de
secretos, no introduce SQL injection ni command injection, no contiene
credenciales hardcoded, y delega la criptografía a las primitivas
auditadas en Tareas 4.5 / 4.6.

Hallazgos: ninguno crítico. Cinco observaciones (low/info) listadas
abajo, todas defensivas y no bloqueantes.

---

## CRÍTICOS (CERO)

Ninguno.

---

## High (CERO)

Ninguno.

---

## Medium (CERO)

Ninguno.

---

## Low

### L-1 — Stub error messages exponen rutas internas

`McpFacadeNotImplementedError` y `CliFacadeNotImplementedError` incluyen
en su `Error.message` rutas como `see composition/facades/cli-facades.ts`
y `composition/facades/mcp-server-facades.ts`. Estas rutas serán
visibles en respuestas MCP y stderr del CLI cuando un usuario invoca un
flujo pendiente (`rekey`, `add-key`, `export-key`, `uninstall-hook`,
`server`, `task.get/delete`).

- **Impacto**: A09 minor — leak de detalles internos del repo a clientes
  externos.
- **Severidad**: low (no es secreto, pero choca con la regla "errores no
  exponen stack traces internos al cliente MCP").
- **Sugerencia**: omitir la ruta del archivo del mensaje. Conservarla en
  `code` (`composition.cli-facade-pending`) ya da trazabilidad interna
  vía logs estructurados, sin enviarla por el wire.
- **Archivos**:
  - `code/src/composition/facades/cli-facades.ts:148-149`
  - `code/src/composition/facades/mcp-server-facades.ts:114-117`

### L-2 — `--passphrase` documentado pero no enforced para entornos no-script

`CommanderCliParser` registra la flag con la nota
`"non-interactive passphrase (avoid in shell history)"`. La nota es
correcta, pero no hay enforcement de "TTY-only por defecto, argv
opt-in". Auditoría preventiva: si un usuario novato copia el comando
con `--passphrase` desde docs, queda en `bash_history`.

- **Impacto**: A07 leve — no es vulnerabilidad sino riesgo de fuga por
  user-error.
- **Severidad**: low.
- **Sugerencia**: añadir un warning impreso a stderr cuando `--passphrase`
  se proporciona vía argv (por encima del comportamiento actual). Fuera
  del scope estricto de Tarea 4.7; documentado para Fase 5.

---

## Info

### I-1 — DestroyEncryptionFacadeAdapter: passphrase handling correcto

`DestroyEncryptionFacadeAdapter.destroy` (`workspace-encryption-facades.ts:155-175`):
- Recibe `passphrase: string`, la envuelve inmediatamente en
  `Passphrase.from(input.passphrase)` (VO con redacción + zeroización
  validada en Tarea 4.6).
- Pasa el VO al `DestroyEncryptionUseCase` que ya tiene la authority
  gate documentada (re-deriva clave + valida ownership antes de
  borrar).
- NO loggea la passphrase en ningún punto del adapter.
- Errores típados (`KeyValidationFailedError`,
  `EncryptionNotInitializedError`) se relanzan sin desenmascarar.

### I-2 — ChangeModeUseCase: enforcement de passphrase

`ChangeModeUseCase.change` (`change-mode.use-case.ts:79-113`):
- Cuando `becomingEncrypted` o `leavingEncrypted`: rechaza con
  `InvalidInputError` si `passphrase === null || length === 0`.
- NO persiste la passphrase en `config.json` (sólo modes / ids /
  embedder).
- Se propaga al facade y se descarta tras la llamada (cierre del
  scope).

### I-3 — EventBusPublisher / InMemoryEventBus: zero-leak

- `EventBusPublisher.publish/publishAll` (`event-bus-publisher.ts`):
  trampolín puro al bus, sin transformación ni log.
- `InMemoryEventBus.runHandler` (`in-memory-event-bus.ts:152-170`):
  cuando un subscriber lanza, sólo loggea
  `{ eventName, err: err.message }` — NO el `event.payload` que podría
  contener metadata de workspace o turn (validado a nivel domain en
  Fase 1: los DomainEvents no transportan secretos).

### I-4 — Logs en composition

Únicamente dos `logger.warn` activos:
- `cli-facades.ts:347-350` — `{ kind: result.error.kind }` en el
  install-hook rejection.
- `mcp-server-facades.ts:157-160` — `{ tool: "mem.init" }` en el
  rechazo de mem.init encrypted.

Ambos contienen sólo metadata pública. No hay `logger.info/.debug/.error`
con `passphrase`, `key`, `salt`, `nonce`, `content`, ni `query`. Ningún
`console.log/.error/.warn` en `composition/`.

### I-5 — RememberFacadeAdapter / RecallMemoryFacadeAdapter

- Reciben `input.content` / `input.query` y los reenvían a los use
  cases, sin loguearlos.
- El sanitizer / scanner de secretos sigue su responsabilidad en el
  módulo `secrets`; el composition root no escanea ni filtra
  (responsabilidad correcta del módulo).

---

## Verificaciones ejecutadas

| Check | Comando | Resultado |
|---|---|---|
| Sin SQL injection | `grep -rEn "db\.(prepare|exec|run)\([\`'\"][^\\\`'\"]*\\\$\{" code/src/composition/` | 0 matches |
| Sin command injection | `grep -rEn "child_process|exec\(|execSync" code/src/composition/` | 0 matches |
| Sin console.* | `grep -rn "console\." code/src/composition/` | 0 matches |
| Sin secretos hardcoded | `grep -rEn "password\|secret\|apiKey\|token" code/src/composition/` | 0 matches sustantivos (sólo nombres de módulos / VOs) |
| Logs sin secretos | `grep -rn "logger\." code/src/composition/` | 2 calls; ambos solo metadata |
| Path canonicalization | `WorkspacePath.create` aplicado en cada facade CLI/MCP que consume rootPath | OK (15 sites) |
| Passphrase wrapping | `Passphrase.from(...)` en cada uno de los 3 adapters de encryption | OK |
| Stubs typed | Todos los stubs lanzan `*FacadeNotImplementedError` | OK |
| Discriminated unions | `RememberFacade.kind` y `TrackTask.action` con `never` exhaustiveness | OK |
| ContextLayerKind mapping | Bidireccional, frozen, sin `as` casts | OK |
| Wipe confirmation | `CliWipeFacadeAdapter` valida `input.confirmed` antes de delegar | OK |

---

## Veredicto

**APPROVED**

CERO violaciones críticas o high. La propagación de la passphrase a
través del composition root es correcta: se mantiene como `string` plano
sólo en el cruce inevitable módulo↔módulo (la regla docs/12 §1.5 exige
que `workspace` no importe `Passphrase`), e inmediatamente se envuelve
en el VO redactado al entrar a `encryption`. El use case tiene authority
gate documentada y ya validada en Tarea 4.6. Los 5 hallazgos low/info
son defensivos y no bloquean el cierre de Tarea 4.7.
