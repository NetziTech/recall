# Security Auditor — Fase 4 / Tarea 4.6

> Validador: `security-auditor`
> Alcance: `JsonEncryptionConfigRepository` + `DestroyEncryptionUseCase`
>           + `EncryptionDestroyed` + `EncryptionConfigPersistenceError`
> Fecha: 2026-04-27

---

## Resumen ejecutivo

La Tarea 4.6 implementa la persistencia filesystem-backed de la
slice de cifrado en `config.json` y el use case `destroy-encryption`
(autoridad probada por passphrase + delete idempotente + evento de
auditoría).

La superficie crítica (persistencia de KeyEnvelopes, validator blob,
gating por passphrase + validator, no-secrets-in-logs) cumple las
reglas de seguridad documentadas en `docs/11-seguridad-modos.md` y
los invariantes establecidos en Tarea 3.2.

**CERO hallazgos críticos.**

---

## CRÍTICOS

_Ninguno._

---

## High

_Ninguno._

---

## Medium

### M-1 — `Date.now()` + `process.pid` en sufijo de tempfile (no critical, but noted)

- **Archivo**: `json-encryption-config-repository.ts:431-434`
- **Detalle**: El sufijo del tempfile combina `process.pid` y
  `Date.now()`. No es CSPRNG y un atacante local que conozca
  ambos podría predecir el path; sin embargo, el directorio
  contenedor `.mcp-memoria/` se crea con `0o700` (línea 440), lo
  que cierra el vector de symlink-attack desde otra cuenta no
  privilegiada.
- **Riesgo residual**: bajo. Documentado implícitamente por el
  modelo de un único usuario operando el CLI/MCP en su propia
  HOME.
- **Recomendación opcional (no bloqueante)**: usar
  `crypto.randomBytes(8).toString("hex")` en el sufijo para
  endurecer contra cualquier escenario multi-usuario futuro.
  Documentar como Fase 5 hardening si flock se introduce.

### M-2 — Falta zero-fill explícito de `derivation.value` y `candidate` MasterKey en `tryUnwrap`

- **Archivo**: `destroy-encryption.use-case.ts:183-202` (mirror de
  `unlock-encryption.use-case.ts`).
- **Detalle**: El `DerivedKey` resultante de `kdf.derive` y el
  `MasterKey` recuperado de `envelopeCipher.unwrap` no se ceran
  explícitamente con `fill(0)` en `finally`. La gestión queda
  delegada al GC y a la disciplina de redacción en VOs.
- **Aceptable porque**: (a) los VOs `MasterKey`/`DerivedKey`
  redactan `toString`/`toJSON`; (b) `MasterKey.withBytes` entrega
  copia defensiva; (c) JS no expone `mlock`; (d) el use case
  `unlock` ya validado en Fase 3 sigue el mismo patrón.
- **Riesgo residual**: bajo. Best-effort consistente con el
  estado del arte JS. JSDoc del use case (líneas 84-89) ya
  documenta la limitación.

---

## Low

### L-1 — Path absoluto del workspace en mensajes de error
- **Archivo**: `encryption-config-persistence-error.ts:80-114`
- Se quoting del `workspaceRoot` en el `message`. **Aceptable**
  por HANDOFF §6.6 (ya autorizado en validaciones de Fase 2).
- Ningún byte de secreto entra en el mensaje (passphrase, master
  key, derived key, validator plaintext, AEAD tag). El JSDoc del
  error subraya la invariante.

### L-2 — Idempotencia verbosa en logs de `delete`
- `json-encryption-config-repository.ts:322-329, 358-365`
- Los outcomes `no-config-file` y `no-encryption-slice` se logean
  con `info`. Sin secretos. Útil para audit-trail. OK.

---

## Info

### I-1 — Cero crypto custom; cero `console`; cero SQL en estos archivos
- `grep` confirmó:
  - Sin `createCipher` / `MD5` / `SHA1`.
  - Sin `console.*`.
  - Sin `db.prepare/exec` (es JSON repo, no toca SQLite).
  - Sin `child_process` / `exec` / `spawn`.

### I-2 — Permisos `0o600` aplicados doblemente
- `writeFile` con `mode: 0o600` (línea 452) **y** `chmod` 0o600
  posterior (línea 454). Resistente a umask permisivo. Conforme a
  `docs/11-seguridad-modos.md` §7.

### I-3 — Atomic write correcto
- Patrón `writeFile(temp) → chmod → rename` con cleanup
  best-effort en catch. POSIX-atomic. Documentado en JSDoc líneas
  186-191.

### I-4 — Path canonicalization defensiva
- `assertSafePath` rechaza `\0`, paths no-absolutos y segmentos
  `..` ANTES de `path.resolve` (líneas 472-493). Re-resuelve en
  `configFilePath` y verifica `startsWith(expectedPrefix)` para
  detectar escape lateral.

### I-5 — Concurrent writes documentados como limitación
- JSDoc líneas 172-178 declara que el adapter no toma flock
  process-level. Fase 5 hardening explícitamente flagged.

### I-6 — Persistence de `KeyEnvelope.cipher_blob` solo via accessors VO
- `withCiphertext`/`withIv`/`withTag` (líneas 546-560) son los
  ÚNICOS puntos de extracción de bytes. NUNCA se serializa
  `MasterKey.bytes` ni `DerivedKey.bytes` plaintext. Verificado
  con `grep "MasterKey\.bytes|DerivedKey\.bytes"` → 0 hits.

### I-7 — KeyValidator constant-time
- `KeyValidatorBlob.matches` (líneas 157-165 del VO) recorre el
  array completo con XOR-OR acumulativo. Sin timing oracle en el
  gating de autoridad del destroy.

### I-8 — Wrong-passphrase outcome no leakea info estructural
- `destroy-encryption.use-case.ts:139-145` retorna
  `KeyValidationFailedError(workspaceId)`. No expone número de
  envelopes intentados ni qué envelope falló. Log warn idem.

### I-9 — `EncryptionDestroyed` event payload mínimo
- `EncryptionDestroyed` solo carga `workspaceId` + `occurredAt` +
  `eventName`. Ningún byte de master key, validator, passphrase
  ni derived key. JSDoc subraya la invariante (líneas 20-26).

### I-10 — Use case NO toca SQLite
- `grep "SqliteDatabase|wipe|memoria.db|vectors.db|sqlcipher"` →
  solo aparece en el JSDoc explicando el boundary (líneas 68-75).
  El use case se limita a la slice de cifrado.

### I-11 — Migration tolerance (lectura tolerante)
- `FULL_CONFIG_SCHEMA` usa `z.looseObject(...)` con todos los
  campos de cifrado `.optional()`. Un `config.json` previo sin
  slice de cifrado se lee y `findByWorkspace` retorna `null` sin
  errar (líneas 247-257).

### I-12 — `delete` preserva otras slices
- En vez de `delete obj.key` (prohibido por lint), construye un
  objeto nuevo filtrando un set explícito `ENCRYPTION_OWNED_KEYS`
  (líneas 337-355). Las slices `workspace`, `embedder`,
  `secrets`, `retrieval`, `curator` round-trip verbatim.

### I-13 — `findByWorkspace` cross-checks `workspace_id` embebido
- Líneas 282-287: si la slice serializada referencia un
  `workspace_id` distinto al solicitado → `malformed`. Mitiga
  composition-root drift entre módulos workspace y encryption.

### I-14 — Logs solo metadata pública
- `grep "logger\."` en ambos archivos → 9 hits. Cada uno revisado
  manualmente: solo `workspaceId`, `keyId`, `envelopeCount`,
  `operation`, `outcome`, `atMs`. Cero passphrase / cero master
  key / cero validator bytes.

### I-15 — Base64 round-trip strict
- `fromBase64` rechaza alfabeto no-estándar, padding incorrecto y
  detecta truncación silenciosa de `Buffer.from` reencodificando
  y comparando (líneas 699-728). Defensa contra
  `config.json` parcialmente corrupto.

---

## Verificaciones ejecutadas

| Check | Resultado |
|-------|-----------|
| `grep "logger\." en ambos archivos` | 9 hits, todos metadata pública. |
| `grep "console\." en módulo encryption` | 0 hits operativos (solo doc en master-key.ts). |
| `grep "password|secret|apiKey|token"` en files audit | 0 hits de credenciales hardcoded. |
| `grep "chmod|0o600|0o700|mode:"` | `0o600` en writeFile + chmod; `0o700` en mkdir. |
| `grep "MasterKey\.bytes|DerivedKey\.bytes"` | 0 hits → no serialización plaintext. |
| `grep "rename|writeFile|tempPath"` | atomic write correcto. |
| `grep "createCipher|MD5|SHA1[^0-9]"` | 0 hits. |
| `grep "db\.(prepare|exec|run)"` | 0 hits (JSON repo, no SQL). |
| `grep "exec\(|spawn\(|child_process"` | 0 hits. |
| `grep "SqliteDatabase|wipe|memoria.db|vectors.db|sqlcipher"` | solo en JSDoc explicando boundary. |
| Path canonicalization (`isAbsolute`, `..`, `\0`) | rechazos explícitos en `assertSafePath`. |
| KeyValidatorBlob constant-time | confirmado en VO líneas 157-165. |
| Idempotencia delete | dos ramas con outcomes distintos, sin leakage. |
| Wrong-passphrase outcome | retorna `KeyValidationFailedError(workspaceId)` sin estructura adicional. |
| Concurrency note en JSDoc | presente líneas 172-178. |

---

## Veredicto

**APPROVED**

Tarea 4.6 cumple las reglas de seguridad documentadas. Cero
críticos, cero high. Los dos hallazgos medium son endurecimientos
opcionales (sufijo CSPRNG en tempfile; zero-fill explícito en
finally del use case) consistentes con el estado actual del módulo
y el patrón ya validado en Fase 3 (`unlock-encryption`).
