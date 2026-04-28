# Security Audit — Fase 3 Tarea 3.5

`modules/workspace/{application,infrastructure}` + `modules/cli/{application,infrastructure}` + `migrations/004__core-memory-schema.sql`.

## Resumen

Auditoria mapeada a OWASP Top 10 + hardening de filesystem por
`docs/11-seguridad-modos.md`. CERO criticos. Una recomendacion `medium`
sobre TOCTOU del `.gitignore` (atomic write ausente) y varias notas
informativas. La capa cumple las garantias de modo (transicion
`encrypted -> shared` rechazada por el agregado, init de modo
`private` aplica `.gitignore`, `0o600`/`0o700` aplicados explicitamente
con re-`chmod` defensivo). El parser canonicaliza paths antes de
entregarlos a use cases. La migracion `004` es DDL puro sin
interpolacion, con FKs e indices parciales por agregado.

## CRITICOS

Ninguno.

## High

Ninguno.

## Medium

### M1 — `.gitignore` no es atomico

**Archivo**: `code/src/modules/workspace/infrastructure/filesystem/node-workspace-filesystem.ts:234-284` (`ensureGitignore`).

**Detalle**: el `config.json` se persiste con write-temp + rename
atomico (lineas 217-223), pero `.gitignore` se sobrescribe directamente
con `fs.writeFile(gitignorePath, expected, "utf8")` (linea 255 y 276).
Si dos invocaciones CLI colisionan, una puede leer + escribir mientras
otra sobrescribe; tambien un crash mid-write deja un `.gitignore`
truncado en el repo del usuario. Bajo modo `private` un truncamiento
puede borrar la linea `.mcp-memoria/`, exponiendo el directorio al
indice git en el siguiente `git add`. Riesgo informacional real
(modo `private` busca exactamente esa garantia).

**Mitigacion**: replicar el patron temp+rename de `writeConfig` para
`.gitignore`. Coste minimo, ya conoces el directorio.

### M2 — DB file (`memoria.db`) sin chmod explicito

**Archivo**: `code/src/modules/workspace/infrastructure/persistence/sqlite-database-bootstrap.ts:70-93`.

**Detalle**: la base de datos se abre con
`SqliteDatabase.open({ path: databasePath, ... })`. El bootstrap NO
hace `fs.chmod(databasePath, 0o600)` despues de la creacion. La
proteccion depende de `SqliteDatabase` (modulo shared) o de
`umask`. En sistemas con umask permisivo (`0o022`) el archivo nace
`0o644`. En modo `encrypted` el contenido esta cifrado, pero en
modo `shared` y `private` la base es plaintext y la confidencialidad
del workspace se reduce a permisos del directorio padre (`0o700`,
correcto). Severidad media porque la pereta del filesystem ya esta
restringida, pero la defensa en profundidad indica chmod-ear el archivo
mismo.

**Mitigacion**: tras `SqliteDatabase.open` en `bootstrap`, agregar
`await fs.chmod(databasePath, 0o600)`. La verificacion ya existe en el
puerto del shared module (segun el reporte 3.1) — confirmar que
realmente lo aplica, sino aplicar aqui.

## Low

### L1 — `Probe.probe()` registra `err.message` ante key resolver fallido

**Archivo**: `sqlite-database-bootstrap.ts:106-113`.

`logger.warn({ err: err instanceof Error ? err.message : String(err) }, "key resolver failed during database probe; treating as locked")`.
Si el resolver falla con un error que cargue accidentalmente bytes de
la passphrase en su mensaje, se filtra. Hoy el modulo encryption no
incluye material sensible en `err.message`, pero como dependencia
externa al adapter es prudente acotar aqui (`{ errCode: err?.code }`).

### L2 — Comparacion de passphrase con `!==`

**Archivos**: `workspace-handlers.ts:139,172`; `encryption-handlers.ts:76,113`.

`if (first !== second) throw new PassphraseMismatchError()` no es
constant-time. Aceptable: ambas cadenas vienen del mismo prompt en el
mismo proceso, no hay attacker-controlled timing. Documentar como
`Acepted (no auth context)` o, mejor, usar `crypto.timingSafeEqual`
sobre buffers convertidos. Severidad baja.

## Info

- **I1** Cero ocurrencias de `console.*` en los modulos auditados.
  Logger inyectado siempre.
- **I2** Cero hardcoded credentials. Las unicas cadenas que matchean
  `password|secret|apiKey|token` son comentarios doc o nombres de
  parametros (`token` en `padBoxLine`, `secret-pattern detection`).
- **I3** Cero `child_process` / `eval` / `new Function` en el alcance.
- **I4** Cero `process.env` consumido por handlers o adapters CLI/
  workspace (la passphrase no-interactiva pasa por el entrypoint
  composition root, no por env directo en los handlers — confirmado
  en `workspace-handlers.ts:130-134`).
- **I5** `commander` se inicializa con `.exitOverride()` (ningun
  `process.exit` desde el parser); errores se mapean a
  `UnknownCommandError` / `InvalidCommandArgsError` y suben al
  entrypoint que decide el exit code. Buena defensa.
- **I6** El `config.json` se escribe con write-temp+rename y `chmod`
  explicito al `0o600` (linea 222), incluso si el SO ignoro `mode`
  inicial.
- **I7** El directorio `.mcp-memoria/` se chmod-ea explicitamente a
  `0o700` despues de `mkdir` (linea 123) — defiende contra umask
  permisivos.
- **I8** Zod con `z.looseObject` (PERSISTED_CONFIG_SCHEMA) preserva
  campos desconocidos durante el merge (`writeConfig` re-lee
  `existing` y hace spread). Esto permite que las sub-slices
  `key_envelopes`/`kdf_params` del modulo encryption se conserven
  sin que workspace las parsee — correcto, satisface el aislamiento
  modular.
- **I9** `MarkerBasedWorkspaceDetector.MAX_DEPTH = 64` con corte
  cuando `path.dirname(current) === current` (linea 89-92): el
  upward walk no escala fuera del root, no hay symlink-loop attack.
- **I10** `resolveRootPath` rechaza NUL bytes y resuelve con
  `path.resolve` (lineas 23-29). Defensa frente a path injection
  desde argv.
- **I11** Migracion `004`: DDL puro (no template strings con
  interpolacion). FKs presentes (`turns->sessions`,
  `relations->entities`). Indices parciales en `superseded_by`,
  `consolidated_into`, `ended_at_ms` minimizan superficie. Sin
  hardcoded data. Triggers FTS5 son single-statement insert/update/
  delete dentro de `BEGIN ... END` — sin TOCTOU.
- **I12** `ChangeModeUseCase` deja la transicion `encrypted->shared`
  al agregado (`InvalidModeTransitionError`) y solo pasa por aqui
  para `encrypted->private`. Los efectos de borrado de envelope se
  hacen ANTES del flip de modo y `config.json` se actualiza DESPUES
  del destroy — orden correcto para recuperabilidad.
- **I13** `InitializeWorkspaceUseCase` aplica `.gitignore` despues
  de crear el directorio, persistir config, y bootstrap. Si el
  proceso muere antes, `.gitignore` no quedara sucio (mejor: ya
  esta el `.mcp-memoria/` directory creado y la siguiente `init`
  rehidrata; el `ensureGitignore` se vuelve a llamar). Aceptable.
- **I14** `renderEncryptionKeyBanner` imprime la clave una unica
  vez. El handler la pasa a `CommandOutputClass.stdoutOnly` y el
  entrypoint la escribe a stdout (no a stderr ni a logs), cumpliendo
  `docs/11 §3`.

## Verificaciones realizadas

| Check | Resultado |
| --- | --- |
| Path traversal en filesystem adapter | OK (`path.resolve`, paths derivados de constantes) |
| `..` rechazado por `resolveRootPath` | OK indirectamente — `path.resolve` colapsa, NUL rechazado |
| Permisos `0o600` en `config.json` | OK (constante + chmod explicito tras write) |
| Permisos `0o700` en `.mcp-memoria/` | OK (mkdir mode + chmod re-applied) |
| Atomic write en `config.json` | OK (write-temp + rename) |
| Atomic write en `.gitignore` | NO (medium M1) |
| Permisos en `memoria.db` | NO chmod explicito (medium M2) |
| `config.json` valida con Zod al leer | OK |
| Sub-slices encrypted/secrets/etc preservadas en re-write | OK (`looseObject` + spread) |
| Cero `console.*` en handlers/adapters | OK |
| Cero hardcoded creds | OK |
| Cero passphrase en logs | OK (logger payloads solo `workspaceId`/`mode`/`exitCode`) |
| Cero `child_process` / `eval` / `Function` | OK |
| Argv parser sin `process.exit` | OK (`exitOverride`) |
| Commander mapea errores a CLI domain errors | OK |
| Migracion 004: DDL puro, sin interpolacion | OK |
| FKs en migracion 004 (turns->sessions, relations->entities) | OK |
| Indices parciales en superseded/consolidated/ended | OK |
| Triggers FTS5 sin TOCTOU | OK |
| Transicion `encrypted -> shared` rechazada | OK (delegada al agregado) |
| `private` modo aplica `.gitignore` | OK |
| `wipe` exige `WIPE` literal o `--confirm` | OK (`maintenance-handlers.ts:148`) |
| `export-key` requiere workspace unlocked | OK (precondicion documentada en handler) |
| `rekey`/`add-key` rechazan no-interactivo | OK |
| Passphrase confirmation con re-prompt | OK |
| Banner de clave imprimido a stdout una vez | OK |

## Veredicto

**APROBADO**. Cero criticos, cero highs. Las dos observaciones medium
(M1 atomicidad de `.gitignore`, M2 chmod explicito sobre `memoria.db`)
son hardening de defensa-en-profundidad y NO bloquean la fase. Se
recomienda fuertemente abordarlas en backlog cercano (especialmente
M1 que afecta directamente al modo `private`). Las observaciones low
(L1 logger error redaction, L2 constant-time compare) son mejoras
opcionales sin impacto practico en el modelo de amenazas actual.

