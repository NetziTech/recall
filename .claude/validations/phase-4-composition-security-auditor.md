# Validacion seguridad — Fase 4 (Composition Root)

Auditor: `security-auditor`
Alcance: `code/src/composition/` (21 archivos) + `code/src/bootstrap/` (5 archivos)
Referencia: `docs/11-seguridad-modos.md`, OWASP Top 10, HANDOFF.md §6.7.

---

## 1. Resumen ejecutivo

La Fase 4 cumple el contrato de composition root sin introducir
vulnerabilidades. Los puntos criticos de manejo de claves fueron
verificados:

- La clave maestra **no se expone** por la superficie publica del
  `Container` (no hay campo `encryptionKey`, `unlockedKey`, ni similar).
- El resolver es un closure stateful en `bootstrapComposition` cuya
  unica via de mutacion es a traves del propio binding lexico — el
  binding NO se pasa hacia arriba.
- `shutdown()` ejecuta `unlockedKey.bytes.fill(0)` antes del
  `process.exit` registrado por SIGTERM/SIGINT.
- Cero `console.log` con secretos. Cero llamadas a `logger.*` con
  campos sensibles. El `PinoLogger` aplica un baseline de redact con
  ~30 paths (passphrase, key, masterKey, derivedKey, encryptionKey,
  salt, etc.) en `DEFAULT_REDACT_PATHS`.
- Stubs `Pending*Facade` y `Pending*Repository` lanzan errores tipados
  con codes deterministicos sin revelar info de implementacion
  sensible.
- Migraciones se ejecutan via `MigrationsRunner` (DDL) ANTES de devolver
  el container; fallan rapido y cierran el handle en error.
- Los entrypoints validan `argv` solo despues de que `WorkspacePath.create`
  canonicaliza el path en cada facade.

**Veredicto: APPROVED** — ninguna observacion CRITICA, HIGH ni MEDIUM.

---

## 2. CRITICOS

Ninguno.

---

## 3. HIGH

Ninguno.

---

## 4. MEDIUM

Ninguno.

---

## 5. LOW

### LOW-1 — `unlockedKey` es write-only desde fuera del closure (gap funcional, no de seguridad)

- **Archivo**: `code/src/bootstrap/composition-root.ts:170-177`
- **Detalle**: La variable `unlockedKey: EncryptionKeyBytes | null` se
  declara y se inicializa a `null`, pero NO existe ninguna funcion
  expuesta (ni en el closure ni en el `Container`) que permita
  mutarla. El resolver siempre devolvera `null`. Esto es esperado en
  Fase 4 (encryption persistence + cache de claves estan diferidos a
  Fase 5 — ver `pending-encryption-config-repository.ts`), pero
  significa que cualquier flujo `mode === "encrypted"` recibira
  `null` como clave y la apertura del SQLCipher fallara al validar
  con `DatabaseError.encryptionKeyRejected`.
- **Riesgo de seguridad**: cero. Es un fail-closed. Sin embargo es
  importante que Fase 5 introduzca el setter como funcion del closure
  y NO como campo del `Container` (proteger la propiedad de
  encapsulamiento auditada aqui).
- **Recomendacion (Fase 5)**: exponer un metodo `setUnlockedKey(key)`
  en el resolver mismo (closure local, no en `Container`). El test
  para Fase 5 debera grep `container.encryptionKey` y `container.unlockedKey`
  y fallar si aparecen.

### LOW-2 — `Pending*` errors mencionan rutas de archivos de codigo

- **Archivos**: `composition/facades/cli-facades.ts:138`,
  `composition/facades/mcp-server-facades.ts:71-74`,
  `composition/facades/workspace-encryption-facades.ts:144`,
  `composition/persistence/pending-encryption-config-repository.ts:54`,
  `composition/persistence/pending-memory-repositories.ts:48`.
- **Detalle**: Los mensajes de error incluyen `(see composition/facades/cli-facades.ts).`
  o similar. Es debug-info util en desarrollo pero filtra la
  estructura interna del binario al usuario final.
- **Riesgo**: muy bajo (mcp-memoria es un CLI single-user; el
  atacante con stdout ya tiene mas que esto). En produccion la
  practica recomendada es retornar solo el `code` y un mensaje
  generico.
- **Recomendacion**: opcional para Fase 5 — anadir un mapper en
  `RunCliCommandUseCase` que ofusque el `(see ...)` antes de
  imprimir. No bloqueante.

---

## 6. INFO

### INFO-1 — Defense in depth de redaccion centralizada

`PinoLogger.DEFAULT_REDACT_PATHS` (en `shared/infrastructure/logger/pino-logger.ts`)
cubre 30+ rutas con wildcards `*.passphrase`, `*.key`, `*.masterKey`,
etc. Un grep contra `logger\..*\b(key|password|token|secret|passphrase)\b`
en composition/bootstrap devolvio CERO matches. Buena practica
implementada.

### INFO-2 — `EncryptionKeyBytes` solo aparece en types

Las unicas ocurrencias de `EncryptionKeyBytes` o `MasterKey` en
composition/bootstrap son:
- Imports de tipo para tipado estricto de funciones.
- El binding lexico `unlockedKey` en `bootstrapComposition`.
- El campo `unlockedKey` del aggregate `EncryptionConfig` (privado;
  acceso solo via `withUnlockedKey(callback)`).

Ningun getter expone los bytes hacia afuera. Cumple `docs/11 §3`
("La clave NUNCA se loguea ni se muestra en stdout").

### INFO-3 — SIGTERM/SIGINT lifecycle

Ambos entrypoints (`cli-entrypoint.ts:38-47`, `mcp-server-entrypoint.ts:42-52`)
registran handlers que:
1. Idempotentes (guard con `state.value`).
2. Loggean el signal recibido por el `Logger` (que aplica
   redacciones).
3. Llaman `shutdown()`, que cierra la DB y zero-fillea la clave.
4. `process.exit(143|130)` con codigos POSIX correctos.

### INFO-4 — Pre-logger fatals

`cli-entrypoint.ts:65-67` y `mcp-server-entrypoint.ts:81-84` usan
`process.stderr.write` solo en el `.catch()` exterior cuando
`bootstrapComposition` mismo fallo (no hay logger todavia). Mensaje:
`mcp-memoria: fatal: <err.message>`. NO se imprime stack trace.
Cumple A05.

### INFO-5 — JSON-RPC errors en mcp-server-entrypoint

El `StdioJsonRpcServer.start()` errors caen al `catch` que loggea por
`container.logger.error` con `err.message` (no stack). El servidor en
si fue auditado en Fase 3.

### INFO-6 — argv y canonicalizacion

`process.argv.slice(2)` se pasa a `CliEntrypoint.run(argv)`. El
parser (Commander) lo procesa, y cada facade adapter wrappa los
strings de path con `WorkspacePath.create()` que normaliza con
`path.resolve` (validado en Fase 3). Composition no toca el FS con
strings raw.

### INFO-7 — InMemoryEventBus

`runHandler` captura excepciones de subscribers y las loggea por
`logger.warn` (con redaccion). No cascadea al publisher. No hay
payloads sensibles en eventos: los `DomainEvent` del codebase emiten
solo IDs y nombres de evento (revisado en Fase 3).

### INFO-8 — Migraciones

`bootstrapComposition:194-201` ejecuta `MigrationsRunner.run` que aplica
SQL files (DDL) versionados; en error cierra el handle y rethrow. NO
modifica permisos de la DB. NO ejecuta DML con datos sensibles. OK.

---

## 7. Verificaciones realizadas

- `grep -rnE "logger\..*(passphrase|secret|apiKey|api_key|privateKey)" code/src/composition code/src/bootstrap` → 0 matches.
- `grep -rnE "logger\..*\bkey\b" code/src/composition code/src/bootstrap` → 0 matches.
- `grep -rnE "console\." code/src/composition code/src/bootstrap` → 0 matches.
- `grep -rniE "password|apiKey|privateKey|secret\s*=|token\s*=" code/src/composition code/src/bootstrap` → 0 matches.
- `grep -rnE "createCipher\b|MD5|SHA1[^0-9]" code/src/composition code/src/bootstrap` → 0 matches.
- `grep -rnE "Container.encryption\b|container\.unlockedKey|container\.encryptionKey" code/src` → 0 matches (solo aparece en `ContainerOptions.encryptionKeyResolver` que es input, no output del container).
- `Container` interface (container.ts:111-129) **NO** expone clave ni resolver.
- `unlockedKey.bytes.fill(0)` se invoca en `shutdown()` (composition-root.ts:224).
- `PinoLogger.DEFAULT_REDACT_PATHS` cubre 30+ rutas con wildcards.
- Permisos de FS (0o600/0o700) intactos en `node-workspace-filesystem.ts`; composition no los relaja.

---

## 8. Veredicto final

**APPROVED**

Fase 4 cumple la rubrica de seguridad sin observaciones criticas, high
ni medium. Las dos observaciones LOW son de naturaleza arquitectonica
(no security): se documentan para que Fase 5 las cierre como parte de
su scope normal.

