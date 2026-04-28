# Phase 3 — Task 3.1 — Security Auditor Report

**Auditado por**: `security-auditor`
**Fecha**: 2026-04-27
**Alcance**: `code/src/modules/mcp-server/application/` y `code/src/modules/mcp-server/infrastructure/`
**Referencia**: HANDOFF.md §6.6 / §7-§8, `docs/02-protocolo-mcp.md`, `docs/11-seguridad-modos.md`, OWASP Top 10

---

## Resumen

El módulo `mcp-server` (capas application + infrastructure) implementa un servidor JSON-RPC 2.0 sobre stdio con seis tools registradas, mapeo determinístico de errores y validación Zod estricta. La auditoría revisó:

- 6 use cases (`init/recall/remember/get-context/track-task/check-health`).
- Adaptadores de transporte (`stdio-json-rpc-server`, `json-rpc-handler`, `json-rpc-types`).
- Despachador (`tool-dispatcher`) y mapeador de errores (`error-mapper`).
- Registry estático (`static-tool-registry`).
- 7 schemas Zod (`init`, `context`, `health`, `task`, `recall`, `remember`, `task-list-filter`).
- 5 errores de transporte (`parse`, `invalid-request`, `invalid-params`, `internal`, `mcp-server-infrastructure-error`) y 4 errores de dominio relevantes (`unknown-tool`, `tool-disabled`, base, `invalid-request-id`).

**Resultado neto**: cero vulnerabilidades críticas. La superficie de ataque del adaptador es estrecha (no hay SQL, no hay shell, no hay crypto, no hay red), las validaciones Zod son estrictas (`.strict()` en los 7 schemas) y los logs son redactados por defecto en el `PinoLogger` global. Una observación de hardening (`Medium`) sobre límite de buffer en stdio queda registrada como diferida — el propio adaptador documenta la decisión.

---

## Críticos

**Ninguno.**

---

## High

**Ninguno.**

---

## Medium

### M-1 — Stdio adapter no acota el buffer de entrada (DoS potencial)

- **Archivo**: `code/src/modules/mcp-server/infrastructure/transport/stdio-json-rpc-server.ts`
- **Líneas**: 32–34, 42, 65–66
- **OWASP**: A05 Misconfiguration (parcial) / A04 Insecure Design (parcial)
- **Detalle**: el adaptador concatena `chunk` en `this.buffer` sin tope hasta encontrar `\n`. Un cliente malicioso o un comportamiento patológico podría enviar megabytes sin newline y el proceso crecerá hasta agotar memoria. El propio comentario lo reconoce: *"The adapter does NOT enforce a max frame size; the caller (Node.js stdin) buffers and chunks reasonably for the small request sizes typical of MCP traffic."*
- **Razonamiento**: en MVP single-user el riesgo es bajo (el cliente es Cursor/Claude Code en la misma máquina, no la red), pero es la única defensa contra un cliente MCP bugueado o un proceso corrupto que escriba al stdin del server.
- **Recomendación (no bloqueante para MVP)**: añadir `MAX_FRAME_BYTES` (p.ej. 1 MiB) y, al superarlo, vaciar el buffer + emitir `-32600 Invalid Request` con `id: null`. Documentar la decisión en el JSDoc de `StdioJsonRpcServer`.
- **Veredicto**: aceptable para MVP single-user CLI. Diferir a Fase 5 (hardening pre-1.0) sin bloquear esta tarea.

---

## Low

**Ninguno.**

---

## Info

### I-1 — `cause` y `stack` excluidos correctamente del wire y de los logs

- **Archivos**: `error-mapper.ts:96-101`, `stdio-json-rpc-server.ts:206-224`.
- `mapErrorToJsonRpc` para errores no-tipados devuelve `{ code: -32603, message: "internal error" }` sin `data`, sin `cause`, sin `stack`. Cumple `docs/11 §3` (no exponer info interna en respuestas wire).
- `serialiseError` en stdio adapter expone solo `name`, `message`, `code` opcional — explícitamente NO incluye `cause`, `stack` ni propiedades arbitrarias del error original. Esto previene fuga vía logs cuando una librería ajena adjunta material sensible.

### I-2 — `tools/list` no expone tools deshabilitadas

- **Archivo**: `json-rpc-handler.ts:226-235`.
- El handler filtra `if (reg.isDisabled()) continue;` antes de añadir al output. Cumple la nota en `tool-disabled-error.ts:7-15` que explícitamente argumenta no leakear server state al cliente.

### I-3 — `error.data` solo contiene Zod issues estructurados

- **Archivo**: `error-mapper.ts:62-68` y `tool-dispatcher.ts:204-216`.
- `InvalidParamsError.details` lleva `{path, message, code}` por issue. No incluye el valor que el cliente envió (que podría contener un secreto si el cliente lo coló por error en una propiedad rechazada). Esto es exactamente lo que pide `docs/11 §3`.

### I-4 — El módulo no toca material criptográfico

- Grep `Passphrase|DerivedKey|UserKey|encryption\.` solo encuentra menciones en el `error-mapper.ts` (mapeo de códigos `encryption.locked`, `encryption.invalid-key`, `encryption.key-revoked` → `-32107`/`-32108`/`-32109`). Esos son nombres de códigos canónicos de error de dominio, no manipulación de claves.
- El módulo `mcp-server` no importa nada de `modules/encryption/` ni de `shared/infrastructure/crypto/`. La separación es limpia.

### I-5 — Default redact paths del logger cubren sensibles

- **Archivo**: `code/src/shared/infrastructure/logger/pino-logger.ts:28-60`.
- `DEFAULT_REDACT_PATHS` redacta `passphrase`, `password`, `secret`, `token`, `apiKey`, `key`, `cookie`, `authorization`, `masterKey`, `derivedKey`, `encryptionKey`, `salt` (más wildcards `*.<key>` y `*.headers.<key>`). Defense-in-depth en caso de que un facade futuro pase accidentalmente un campo sensible al logger.
- Los use cases auditados (`remember`, `init`, `recall`, `get-context`, `task`, `health`) loggean solo IDs, contadores, kinds y status — nunca payload completo, nunca content del memory entry.

### I-6 — Bookkeeping defensivo no enmascara fallos de negocio

- **Archivo**: `tool-dispatcher.ts:172-178`.
- `recordInvocation` está envuelto en `try/catch` vacío con justificación documentada (la operación es total bajo precondiciones). Consideré si esto silencia un error de dominio relevante para auditoría, pero el aggregate solo lanza si `Timestamp` es inválido, lo cual el VO de domain garantiza vía `Timestamp.now(occurredAtMs)` invocado justo antes. Aceptado.

### I-7 — `MethodNotFoundError` (handler.ts:313-320) es subclase local correcta

- Hereda de `McpServerInfrastructureError`, fija `jsonRpcCode = -32601` y `code = "mcp-server.method-not-found"`. El mapeo del error-mapper Tier-1 lo captura por `instanceof McpServerInfrastructureError`. No se filtra la lista interna de métodos permitidos: el mensaje de error solo dice `'json-rpc method "X" is not supported'` con el método solicitado.

---

## Verificaciones ejecutadas

| Categoría | Comando | Resultado |
|---|---|---|
| `console.*` en mcp-server | `grep -rn "console\." code/src/modules/mcp-server/` | 0 matches |
| `eval / Function() / vm.runIn / child_process / exec` | `grep -rEn "eval\(\|new Function\(\|vm\.runIn\|child_process\|exec\("` | 0 matches |
| `MD5 / SHA1 / createCipher` | `grep -rEn "MD5\|SHA1[^0-9]\|createCipher\("` | 0 matches |
| SQL prepared/exec en mcp-server | `grep -rEn "db\.(prepare\|exec\|run)\("` | 0 matches |
| `password / secret / token / api_key` | `grep -rEn "password\|secret\|token\|api[_-]?key"` | 100% son nombres de campos `total_tokens`, `max_tokens`, comentarios, o cases del error-mapper para `secrets.detected` y `encryption.*`. Ningún literal hardcoded. |
| `.strict()` en schemas Zod | `grep -n ".strict()" infrastructure/validation/*.ts` | 9 matches sobre 7 archivos (los 7 schemas + 2 sub-schemas internos). 100% cobertura. |
| Stack/cause leakage en wire | revisión manual `error-mapper.ts` + `stdio-json-rpc-server.ts:serialiseError` | confirmado: ni en wire ni en logs |
| Crypto material en mcp-server | `grep -rn "Passphrase\|DerivedKey\|UserKey\|encryption\."` | solo nombres de error codes en mapper. Sin manipulación de claves. |

---

## Mapeo OWASP Top 10

| Categoría | Veredicto | Evidencia |
|---|---|---|
| **A01 Broken Access Control** | OK | El dispatcher solo despacha a las 6 tools del enum `ToolNameKind` (handler frozen en constructor). Métodos no registrados → `-32601` sin enumeración (`json-rpc-handler.ts:198`). MVP single-user CLI no requiere RBAC. |
| **A02 Cryptographic Failures** | OK (N/A) | El módulo no toca crypto. No imports de `encryption/` ni `crypto/`. Logger redacta `passphrase/derivedKey/masterKey/...` por default. |
| **A03 Injection (JSON-RPC)** | OK | `JSON.parse` envuelto en try/catch → `-32700`. Envelope shape via `isJsonRpcRequestShape`. Zod `.strict()` en los 7 schemas rechaza propiedades extra antes del use case. Sin `eval`, sin `Function()`, sin `vm.runIn`, sin SQL. |
| **A04 Insecure Design** | OK | Métodos no registrados → `-32601` sin leak de la lista interna. Errores internos → `-32603` con `"internal error"` genérico (sin `cause`, sin `stack`). `tools/list` filtra deshabilitadas. |
| **A05 Security Misconfiguration** | OK | Sin debug endpoints. El stdio adapter NO escribe a stdout nada que no sea JSON-RPC response (logs van a stderr vía PinoLogger por contrato del puerto). Ver M-1 sobre límite de buffer. |
| **A06 Vulnerable & Outdated Components** | N/A para este módulo | (lo cubre el SBOM/lockfile audit fuera de alcance) |
| **A07 Authentication Failures** | OK (N/A) | MVP single-user CLI; no hay flujo de auth en el adaptador. |
| **A08 Software & Data Integrity** | OK | Zod valida TODOS los inputs antes del use case (despachador `parseInput` línea 189). No hay path de bypass: el handler `tools/call` invoca dispatcher, que SIEMPRE pasa por Zod. Sin deserialización custom. |
| **A09 Logging** | OK | Errores se loggean vía `Logger` inyectado (PinoLogger en composition root). `serialiseError` excluye `cause/stack`. Use cases loggean IDs/contadores, nunca payload content. PinoLogger redacta por default `passphrase/secret/token/key/...`. |
| **A10 SSRF** | OK (N/A) | Sin llamadas HTTP en este módulo. |

---

## Veredicto

**APPROVED** — Cero vulnerabilidades críticas, cero high, una observación medium (M-1 buffer cap) que se difiere a Fase 5 con justificación documentada por el propio código y aceptable para MVP single-user CLI.

El módulo cumple `docs/11-seguridad-modos.md` (no fuga de info sensible en errores wire) y `docs/02-protocolo-mcp.md` §6 (códigos JSON-RPC correctos en error-mapper). La auditoría no encontró ningún path donde un cliente pueda evadir validación Zod, leakear stack traces, ejecutar código arbitrario o inducir comportamiento de injection.
