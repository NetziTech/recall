# Security Auditor — Phase 3 Task 3.2 (encryption + secrets, application + infrastructure)

**Validator**: `security-auditor`
**Scope**: archivos NUEVOS de la Tarea 3.2 (`crypto-security-expert`).
**Fecha**: 2026-04-27.
**Veredicto**: **APPROVED** (cero criticos).

---

## Resumen

Auditoria de la implementacion `application/` + `infrastructure/` de los modulos
`encryption/` y `secrets/` mas la migracion `001__secret-audit-log.sql`. Total:
~38 archivos.

**Calidad de cripto: excelente.** El adapter `Argon2idKdf` enforces los floors
de OWASP 2024 (memoria 64 MiB, 3 iter, 4 lanes) en una segunda capa
defensa-en-profundidad redundante con el VO de dominio. AES-256-GCM con IVs de
12 bytes cripto-aleatorios via `webcrypto.getRandomValues`. Tags de 128 bits
sin truncamiento. CSPRNG via `node:crypto.webcrypto` (sin `Math.random` en
ningun lugar). Cero cripto custom.

**Manejo de claves: correcto.** Todos los buffers temporales se ceran con
`fill(0)` en bloques `finally`. `MasterKey` y `DerivedKey` exponen sus bytes
solo via callbacks (`withBytes`). `Passphrase.withChars` y `SaltBytes.withBytes`
contienen el material secreto en scopes acotados. La adapter
`EncryptionKeyAdapter.toEncryptionKeyBytes` produce una copia fresca y delega
la limpieza al composition root segun el invariante D-020.

**Logs sin secretos.** Verificado por `grep -rEn` en todo el scope: cero
`console.*`, todas las llamadas `logger.*` cargan SOLO metadata publica
(workspaceId, keyId, kind, count, algorithm). Verificado a mano linea por
linea en cada use case.

**SQL injection: ninguno.** El unico repositorio SQL en scope
(`SqliteSecretAuditRepository`) usa exclusivamente prepared statements
(`SQL_INSERT`, `SQL_SELECT_BY_ID`, `SQL_SELECT_BY_WORKSPACE`) con bind params
(`stmt.run(...)`, `stmt.get(...)`, `stmt.all(...)`). Cero string-concat, cero
template-strings con `${}` en SQL. Las pocas template-strings encontradas son
solo en mensajes de error (lineas 170, 225, 258).

**Detector de secrets: 5 capas funcionales.** Patrones, entropia Shannon,
sanitizer de paths, hook pre-commit, audit log; todos implementados con la
disciplina correcta (raw secret nunca sale de `SecretPattern.matches`,
`evidence` redactado a `[REDACTED:<length>]`).

---

## CRITICOS (bloquean APPROVAL)

**Ninguno.**

---

## High

**Ninguna.**

---

## Medium

### M-001 (informativa) — Doble derivacion KDF en multi-envelope unlock

**Archivo**: `code/src/modules/encryption/application/use-cases/unlock-encryption.use-case.ts:144`

**Detalle**: en `tryUnwrap`, cada iteracion del loop sobre envelopes ejecuta
una nueva derivacion KDF completa (~100 ms / 64 MiB cada una). Para v0.5+
multi-key con N envelopes, el costo total escala lineal. Hoy (MVP, 1
envelope) es N=1 y el costo es ~100 ms, dentro del budget de docs/11 §7.

**Por que NO es critico de seguridad**: el costo lineal no es un side-channel
ni un DoS — es la propiedad slow-by-design de argon2id que rate-limita
brute-force. Mantenerlo asi es defendible.

**Sugerencia (no bloqueante)**: cuando llegue v0.5+, considerar un cache
in-memory de `(passphrase, kdfParams) → derivedKey` con TTL muy corto (p.ej.
10 s) que cubre solo el round-trip de unlock multi-envelope, NO la sesion
completa. Documentado para `crypto-security-expert` en futuro ciclo.

### M-002 (informativa) — `SqliteSecretAuditRepository.save` sin transaccion explicita

**Archivo**: `code/src/modules/secrets/infrastructure/persistence/sqlite-secret-audit-repository.ts:151-162`

**Detalle**: `save` ejecuta un solo INSERT, lo cual es atomico en SQLite por
defecto (cada statement es su propia transaccion implicita). Pero si el
adapter creciera para escribir a multiples tablas (e.g. relacion
audit→workspace), habria que envolver en `db.transaction(fn)`.

**Estado actual**: correcto. Marcado solo para tracking si el aggregate crece.

---

## Low

### L-001 — `path.join` consume la ruta cruda despues de validar el alias

**Archivo**: `code/src/modules/secrets/infrastructure/hook/filesystem-pre-commit-hook-installer.ts:115`

**Detalle**: `path.join(input.workspaceRoot, ".git", "hooks")` usa la cadena
RAW. La validacion previa (linea 109) recorre `pathSanitizerRule.apply`, que
rechaza segmentos `..` y caracteres NUL. Por construccion, llegar a la linea
115 implica que el input ya paso la validacion de traversal.

**Por que NO es critico**: el sanitizer rechaza `..`. Symlinks o nombres
extranos quedan a discrecion del filesystem (el adapter solo escribe en
`<workspaceRoot>/.git/hooks/pre-commit` que es predecible).

**Sugerencia (no bloqueante)**: agregar un `path.resolve(input.workspaceRoot)`
antes del join y verificar que el resultado siga conteniendo `.git/hooks` como
prefijo conocido. Defensa adicional contra resolucion de symlinks. Marcar
como hardening para v0.5+.

### L-002 — Hook script ejecuta `mcp-memoria` desde PATH

**Archivo**: `code/src/modules/secrets/infrastructure/hook/filesystem-pre-commit-hook-installer.ts:38-53`

**Detalle**: el hook resuelve `mcp-memoria` via `command -v` desde el `$PATH`
del usuario al hacer commit. Si un atacante con write access al `$PATH` del
usuario inserta un binario malicioso `mcp-memoria`, el hook lo ejecutaria.

**Por que NO es critico**: el modelo de amenaza del hook es "proteger contra
secrets staged accidentalmente", NO "defenderse contra atacante con write
access al filesystem del dev". Si el atacante tiene write a `$PATH`, ya tiene
RCE.

**Sugerencia (no bloqueante)**: en una iteracion futura, hardcodear la ruta
absoluta del binario instalado (resuelta al momento de `install`). Documentar
explicitamente el modelo de amenaza en docs/11.

---

## Info

### I-001 — `derive-passphrase-key.use-case.ts:44` loguea params public

**Archivo**: `code/src/modules/encryption/application/use-cases/derive-passphrase-key.use-case.ts:44-52`

**Detalle**: el use case loguea `algorithm`, `memoryKib`, `iterations`,
`parallelism`. Confirmado contra docs/11 §7 — todos publicos. NO loguea
`salt`, `passphrase`, `derivedKey`. Correcto.

### I-002 — `EncryptionKeyAdapter.toEncryptionKeyBytes` documenta el invariante de limpieza

**Archivo**: `code/src/modules/encryption/infrastructure/database/encryption-key-adapter.ts:62-66`

**Detalle**: la funcion devuelve una copia fresca y documenta que el caller
(composition root) DEBE cerar el buffer despues de
`SqliteDatabase.open(...)`. Esto cierra el TODO de Fase 2 sobre `secure_zero`
del key bytes (HANDOFF.md §6.6 observacion Security-Info). El cierre
explicito sucede en composition root — en alcance la responsabilidad esta
delegada correctamente.

### I-003 — `KeyValidatorBlob.matches` es constant-time

**Archivo**: `code/src/modules/encryption/domain/value-objects/key-validator-blob.ts:157-165`

**Detalle**: comparacion bit a bit con XOR acumulado en `diff` y return final
sobre el acumulador. Sin short-circuit. Correcto contra timing attacks aunque
la posicion blob (sentinel "VALID-WORKSPACE-V1") sea conocida.

### I-004 — `BuiltInPatternRegistry` cubre los 7 patrones de docs/11 §6

**Archivo**: `code/src/modules/secrets/infrastructure/scanner/built-in-pattern-registry.ts:49-111`

**Detalle**: AWS access key, AWS secret access key, JWT, GitHub token, private
key (PEM), password en URL, generic API key. Match exacto contra el catalogo
documentado en docs/11 §6. Convencion `regex.<artifact>` aplicada
consistentemente.

### I-005 — `DefaultSecretsScanner` ordena replacements descendente

**Archivo**: `code/src/modules/secrets/infrastructure/scanner/default-secrets-scanner.ts:170-179`

**Detalle**: las redacciones se aplican sorted by `start desc` para que los
offsets posteriores no inviten al texto ya redactado. Correcto.

### I-006 — `ShannonEntropyCalculator` retorna 0 en input single-character

**Archivo**: `code/src/modules/secrets/infrastructure/scanner/shannon-entropy-calculator.ts:58`

**Detalle**: edge case bien manejado. `EntropyThreshold.minimumLength()` ya
filtra strings cortos antes; este es defensa en profundidad.

### I-007 — Migracion `001__secret-audit-log.sql` es append-only por DDL

**Archivo**: `code/migrations/001__secret-audit-log.sql`

**Detalle**: sin DELETE TRIGGER, sin CASCADE, sin UPDATE. Comentario
documenta que el GC de retencion es trabajo de un job separado, no del
adapter. Idempotente con `CREATE TABLE IF NOT EXISTS` y
`CREATE INDEX IF NOT EXISTS`. Match con el contrato de docs/11 §6 capa 5.

### I-008 — IV de AES-GCM se genera dentro del adapter, no via puerto `RandomBytes`

**Archivo**: `code/src/modules/encryption/infrastructure/cipher/aes-gcm-envelope-cipher.ts:211-215` y duplicado en `aes-gcm-validator-encrypter.ts:118-122`

**Detalle**: el IV se genera con `webcrypto.getRandomValues` directamente,
con justificacion explicita en JSDoc: "los IVs son una preocupacion interna
del primitive AEAD, no del puerto". Defensible (encapsula la decision dentro
del adapter, evita que un test `FakeRandomBytes` reuse IVs accidentalmente).
Duplicacion en 2 archivos (cipher + validator-encrypter) es minima y
documentada.

### I-009 — `MIN_PLAINTEXT_LENGTH_BYTES` enforced en `KeyValidatorBlob.create`

**Archivo**: `code/src/modules/encryption/domain/value-objects/key-validator-blob.ts:110-114`

**Detalle**: el dominio refusa plaintext vacio o sentinels degenerados.
Defensa contra blobs malformed deserializados de `config.json`.

---

## Verificaciones corridas

```bash
# Cero hardcoded secrets / passwords
grep -rEn "(password|apiKey|api_key|token|secret)\s*=\s*['\"]" code/src/modules/encryption code/src/modules/secrets
# → 0 matches

# Cero hex hardcoded > 16 chars
grep -rEn "0x[0-9a-fA-F]{16,}" code/src/modules/encryption code/src/modules/secrets
# → 0 matches

# Cero console.*
grep -rn "console\." code/src/modules/encryption/{application,infrastructure} code/src/modules/secrets/{application,infrastructure}
# → 0 matches

# Logger calls — todas inspeccionadas linea por linea
grep -rn "logger\." code/src/modules/encryption/{application,infrastructure} code/src/modules/secrets/{application,infrastructure}
# → 11 matches; ninguno loguea passphrase, key, derivedKey, salt, plaintext,
#   ciphertext, IV, tag, ni evidence

# SQL injection — string-concat con ${ en queries
grep -rEn "db\.(prepare|exec|run)\([\`'\"][^\\\`'\"]*\\\$\{" code/src/modules/encryption code/src/modules/secrets
# → 0 matches; todas las queries usan prepared statements

# fs.* directos
grep -rEn "fs\.(read|write|chmod|mkdir|stat)" code/src/modules/encryption/infrastructure code/src/modules/secrets/infrastructure
# → 4 matches, todos en filesystem-pre-commit-hook-installer.ts; revisados:
#   - fs.readFile sobre hookFile derivado de path validado
#   - fs.mkdir(hookDir, { recursive: true })
#   - fs.writeFile con mode 0o755 (executable, sin secretos)
#   - fs.chmod(hookFile, 0o755) defensivo contra FS que ignoran mode

# Cross-imports prohibidos (modulo A → modulo B)
grep -rEn "import.*from.*['\"]\.\./\.\./\.\./[^s]" \
  code/src/modules/encryption/{application,infrastructure} \
  code/src/modules/secrets/{application,infrastructure} \
  | grep -v "shared/"
# → 0 matches; todos los imports cross-folder son intra-modulo
#   (../../../domain/...) o hacia shared/

# Algoritmos cripto debiles
grep -rEn "createCipher\(|MD5|SHA1[^0-9]|XOR|Caesar" code/src/modules/encryption code/src/modules/secrets
# → 0 matches

# Math.random en lugar de CSPRNG
grep -rn "Math\.random" code/src/modules/encryption code/src/modules/secrets
# → 0 matches
```

---

## Validacion por seccion del brief

### A. Cripto correcto — APPROVED

| Item | Estado | Verificacion |
|---|---|---|
| KDF usa `@noble/hashes/argon2id` | OK | `argon2id-kdf.ts:1` `import { argon2idAsync } from "@noble/hashes/argon2.js"` |
| memoryKib >= 65536 enforced | OK | `kdf-params.ts:17` MIN_MEMORY_KIB=65536; `argon2id-kdf.ts:104-112` defense-in-depth |
| iterations >= 3 enforced | OK | `kdf-params.ts:18` MIN_ITERATIONS=3; `argon2id-kdf.ts:114-121` |
| parallelism >= 4 enforced | OK | `kdf-params.ts:19` MIN_PARALLELISM=4; `argon2id-kdf.ts:123-130` |
| keyLength == 32 (256 bits) | OK | `argon2id-kdf.ts:142` `dkLen = DerivedKey.lengthBytes()` (32) |
| Salt >= 16 bytes CSPRNG | OK | `salt-bytes.ts:14` MIN_SALT=16; `initialize-encryption.use-case.ts:94` 16-byte CSPRNG |
| Argon2 type/version: argon2id | OK | `argon2id-kdf.ts:134-138` algorithm guard |
| AES-256-GCM IV unico CSPRNG 12B | OK | `aes-gcm-envelope-cipher.ts:15,211-215`; `aes-gcm-validator-encrypter.ts:10,118-122` |
| Tag de 128 bits, no truncado | OK | `AES_GCM_TAG_LENGTH_BITS = 128` en los 3 ciphers |
| AEAD verificado, plaintext NO devuelto si tag falla | OK | `aes-gcm-envelope-cipher.ts:167-172` (throw); `aes-gcm-key-validator.ts:89-97` (return false) |
| NO ECB, NO CBC sin HMAC, NO custom | OK | Solo AES-GCM (AEAD nativo) |
| CSPRNG via webcrypto.getRandomValues | OK | `web-crypto-random-bytes.ts:1,62`; `aes-gcm-envelope-cipher.ts:213` |
| Salt aleatorio CSPRNG | OK | `initialize-encryption.use-case.ts:94` `this.randomBytes.next(SALT_LENGTH_BYTES)` |
| `EncryptionKeyBytes` produce length 32 | OK | `encryption-key-adapter.ts:62-66` proyecta `MasterKey.withBytes` (32B) |
| Clave NO almacenada a largo plazo | OK | `EncryptionKeyAdapter` retorna copia fresca; composition root cera |

### B. Gestion de claves — APPROVED

| Item | Estado | Verificacion |
|---|---|---|
| `secure_zero` en KDF | OK | `argon2id-kdf.ts:166-178` finally block, fill(0) en encodedPassphrase, saltBytes, derivedBytes |
| `secure_zero` en cipher wrap | OK | `aes-gcm-envelope-cipher.ts:98,101` plaintext.fill(0) en throw + success |
| `secure_zero` en cipher unwrap | OK | `aes-gcm-envelope-cipher.ts:188-190` finally block en plaintextView.fill(0) |
| `secure_zero` en validator-encrypter | OK | `aes-gcm-validator-encrypter.ts:82,88,105` plaintextCopy.fill(0) en 3 paths |
| `secure_zero` en key-validator | OK | `aes-gcm-key-validator.ts:100-104` finally block en plaintextView |
| Logs sin passphrase/key/secret | OK | grep verificado; todos los logger.* logs solo metadata publica |
| Permisos 0o600 (no aplicable) | N/A | El modulo no persiste archivos con material sensible (solo el hook con mode 0755) |
| Hook pre-commit no leakea | OK | `filesystem-pre-commit-hook-installer.ts:38-53` script no contiene secretos, solo invoca CLI |

### C. OWASP Top 10 — APPROVED

| Item | Estado | Notas |
|---|---|---|
| A01 Broken Access Control | OK | `SecretAuditRepository` interface limita findById/save/findByWorkspace; sin metodos de delete; persistence append-only por DDL |
| A02 Cryptographic Failures | OK | Cubierto en seccion A. Cero hardcoded keys/secrets verificado. |
| A03 Injection (SQL) | OK | Solo prepared statements con bind params. Verificado linea por linea. |
| A04 Insecure Design | OK | Unlock valida con KeyValidatorBlob ANTES de aceptar (`unlock-encryption.use-case.ts:99-104`). Constant-time comparacion en `KeyValidatorBlob.matches`. |
| A05 Misconfiguration | OK | Defense-in-depth en `Argon2idKdf` re-valida floors aunque el VO ya lo hizo. |
| A07 Auth Failures | OK | Constant-time (KeyValidatorBlob.matches). AEAD authentication-failed mapeado a `false` (no oracle de timing). |
| A08 Data Integrity | OK | Zod schemas en `sqlite-secret-audit-repository.ts:27-71` validan rows deserializados antes de pasar a VO factories. |
| A09 Logging | OK | Cubierto en B. |
| A10 SSRF | N/A | No URLs construidas dinamicamente. |

### D. Path canonicalization — APPROVED

| Item | Estado | Verificacion |
|---|---|---|
| Rechaza `..` antes de `path.join` | OK | `PathSanitizerRule.apply` (dominio) rechaza `path-traversal`; `filesystem-pre-commit-hook-installer.ts:109-112` retorna err si falla |
| Normaliza con sanitizer | OK | `PathSanitizerRule.apply` aplicado en sanitizePath use-case y hook installer |
| Inputs untrusted no llegan a fs.* sin sanitizar | OK | Hook installer valida ANTES de `path.join` raw |

### E. Migracion SQL — APPROVED

| Item | Estado | Verificacion |
|---|---|---|
| Idempotente | OK | `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS` |
| Sin secrets/datos hardcodeados | OK | DDL puro |
| Append-only | OK | Sin UPDATE, sin DELETE TRIGGER, sin CASCADE; documentado en comentario |
| Indices apropiados | OK | `idx_secret_audit_log_by_workspace` cubre query principal `WHERE workspace_id = ? ORDER BY occurred_at_ms DESC` |

### F. Deteccion de secretos (5 capas) — APPROVED

| Capa | Estado | Verificacion |
|---|---|---|
| Capa 1 — Patrones | OK | 7 patrones built-in match docs/11 §6; redaccion `[REDACTED:<length>]` aplicada en `SecretPattern.matches` |
| Capa 1 — Entropia Shannon | OK | Threshold default 4.5 (match docs/11); minimumLength filtra strings cortos |
| Capa 2 — Path sanitizer | OK | `PathSanitizerRule` con 2 modos (tilde-rewrite, relative-only); rechaza `..` y NUL |
| Capa 3 — Modo encrypted | OK | Modulo encryption completo (AES-256-GCM + argon2id + key validator) |
| Capa 4 — Hook pre-commit | OK | Adapter `FilesystemPreCommitHookInstaller`; chmod 0755 idempotente; managed-by marker para idempotencia |
| Capa 5 — Audit on-demand | OK | `SqliteSecretAuditRepository` append-only; `SecretAuditEntry` aggregate con event sourcing |

---

## Veredicto

**APPROVED.**

Cero criticos. Cero highs. 2 mediums informativos (M-001 cache de KDF para
v0.5 multi-key; M-002 transaccion explicita si crece audit save). 2 lows
(L-001 path resolve adicional defensivo; L-002 hook PATH lookup) que son
hardenings post-MVP. 9 informativas que son comentarios positivos sobre
decisiones bien hechas (constant-time, redaccion en source, defense-in-depth,
catalogo de patterns completo).

La implementacion del `crypto-security-expert` cumple OWASP Top 10 aplicado
al modulo, los parametros minimos de Argon2id de docs/11 §3, AES-256-GCM con
IVs unicos CSPRNG, las 5 capas de deteccion de secretos, redaccion estricta
en logs, prepared statements puros para SQL, append-only audit log con DDL
idempotente. Calidad de cripto profesional, sin atajos.

