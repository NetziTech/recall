# Phase 3 Task 2 — DDD Validator Report

**Validator:** `ddd-validator`
**Phase:** 3 (Modules in parallel)
**Task:** 3.2 — `crypto-security-expert` deliverables: `modules/encryption/{application,infrastructure}/` + `modules/secrets/{application,infrastructure}/`
**Date:** 2026-04-27
**Cycle:** 0
**Verdict:** **APPROVED**

---

## 1. Resumen ejecutivo

La triada `domain` + `application` + `infrastructure` de los modulos
`encryption` y `secrets` mantiene coherencia DDD estricta. El lenguaje
ubiquito de `docs/11-seguridad-modos.md` (passphrase, master key,
derived key, key envelope, key validator blob, kdf params, secret
audit entry, sanitized text/path, pattern registry, entropy threshold)
se proyecta linealmente desde domain hasta los nombres de los puertos,
adapters y use cases. Cero violaciones criticas a las 7 reglas
auditadas (R1–R7).

**Cobertura del scope:**
- 4 use cases de encryption (`InitializeEncryption`,
  `UnlockEncryption`, `LockEncryption`, `DerivePassphraseKey`).
- 4 use cases de secrets (`ScanText`, `SanitizePath`,
  `InstallPreCommitHook`, `RecordSecretEvent`).
- 7 puertos en encryption (4 in/ + 3 out/) — Kdf, RandomBytes,
  ValidatorEncrypter como `out/`.
- 5 puertos en secrets (4 in/ + 1 out/ — `PreCommitHookInstaller`).
  Los puertos `SecretsScanner`, `PatternRegistry`, `EntropyCalculator`,
  `SecretAuditRepository` se quedan en `domain/services|repositories`
  (decision documentada y consistente).
- 5 adapters en encryption (`Argon2idKdf`, `AesGcmEnvelopeCipher`,
  `AesGcmValidatorEncrypter`, `AesGcmKeyValidator`,
  `WebCryptoRandomBytes`) + `EncryptionKeyAdapter` (anti-corruption).
- 4 adapters en secrets (`DefaultSecretsScanner`,
  `BuiltInPatternRegistry`, `ShannonEntropyCalculator`,
  `SqliteSecretAuditRepository`, `FilesystemPreCommitHookInstaller`).

---

## 2. Hallazgos criticos (BLOQUEAN)

**Ninguno.** Cero violaciones que bloqueen.

---

## 3. Hallazgos no criticos (warnings — no bloquean)

### W-1 — `secrets.blocked` / `secrets.detected` / `secrets.redacted` event names

**Archivos:**
- `code/src/modules/secrets/domain/events/secret-blocked.ts:27`
- `code/src/modules/secrets/domain/events/secret-detected.ts:31`
- `code/src/modules/secrets/domain/events/secret-redacted.ts:30`

**Detalle:** La convencion de Fase 1 (HANDOFF.md §6.5 decision 1) es
`<module>.<event-name-en-past-tense-kebab-case>`. Los nombres
`secrets.blocked`, `secrets.detected`, `secrets.redacted` son
participios pasados (the secret WAS blocked/detected/redacted) y
satisfacen la regla. Quedan registrados aqui como observacion para
ratificacion del orquestador: si la convencion exige verbo+past
explicito (ej `secret-was-blocked`) habria que renombrar; los
nombres actuales se alinean al patron usado por las contrapartes
de encryption (`encryption.locked`, `encryption.unlocked`,
`encryption.initialized`) y son coherentes entre modulos.

**Severidad:** info / no bloqueante.
**Accion sugerida:** ninguna; consistente con `encryption.*`.

### W-2 — `throw new Error(...)` en `SqliteSecretAuditRepository`

**Archivos:**
- `code/src/modules/secrets/infrastructure/persistence/sqlite-secret-audit-repository.ts:169`
  (validacion `findByWorkspace.limit`)
- mismo archivo, lineas 224 y 257 (assertions `unreachable` sobre
  uniones discriminadas)

**Detalle:** El repositorio lanza `Error` generico para tres
condiciones operacionales:
1. `limit` no entero o ≤0 (bug del caller que viola el contrato del
   puerto `SecretAuditRepository`).
2. Dos `assertNever` exhaustivos (defensa estatica sobre
   `SecretSource.kind`).

Los lineamientos (`docs/12 §1.5` + R7) prefieren errores tipados
(`SecretsInfrastructureError` ya existe en
`infrastructure/errors/secrets-infrastructure-error.ts`). Las
assertions exhaustivas son patron canonico TypeScript y `Error`
crudo es defensible (rama estaticamente unreachable). La validacion
de `limit` SI deberia ser una `InvalidInputError` o un
`SecretsInfrastructureError.invalidLimit(...)` para coherencia con el
resto del modulo.

**Severidad:** low / no bloqueante.
**Accion sugerida (opcional):** introducir
`SecretsInfrastructureError.invalidLimit(limit)` y reemplazar los 3
`new Error(...)` por instancias del nuevo subtipo. No bloquea Fase 3
porque (a) ninguna ruta user-facing alcanza esa rama, (b) el uso de
`Error` no contamina ningun import de `domain/`.

### W-3 — Ausencia de adapter de persistencia para `EncryptionConfigRepository`

**Archivo:** `code/src/modules/encryption/infrastructure/index.ts:8-11`

**Detalle:** El barrel deja explicito que el adapter del
`EncryptionConfigRepository` se entrega en el modulo `workspace`
(donde vive la persistencia de `config.json`). Decision coherente:
`config.json` es propiedad del bounded context `workspace` y la
encriptacion solo aporta los VOs y el aggregate. Queda registrado
como observacion para que `infrastructure-engineer` (workspace + cli)
contemple el adapter en su entrega Fase 3.

**Severidad:** info — interface boundary correctamente delimitada.
**Accion sugerida:** ninguna en este alcance; tracking para
`workspace-expert`.

---

## 4. Verificaciones realizadas

### A. Lenguaje del dominio (Ubiquitous Language) — PASS

| Verificacion | Resultado |
|---|---|
| Use cases con verbos de negocio | PASS — `InitializeEncryption`, `UnlockEncryption`, `LockEncryption`, `DerivePassphraseKey`, `ScanText`, `SanitizePath`, `InstallPreCommitHook`, `RecordSecretEvent`. Cero nombres genericos (`processStuff`, `doThing`). |
| Adapters reflejan dominio + tecnologia | PASS — `Argon2idKdf` (puerto Kdf + lib argon2id), `AesGcmEnvelopeCipher` (puerto EnvelopeCipher + AES-GCM), `AesGcmKeyValidator`, `AesGcmValidatorEncrypter`, `WebCryptoRandomBytes`, `SqliteSecretAuditRepository`, `FilesystemPreCommitHookInstaller`, `ShannonEntropyCalculator`, `BuiltInPatternRegistry`, `DefaultSecretsScanner`. Cada nombre = QUE puerto + COMO tecnologia. |
| Variables y metodos siguen `docs/11` | PASS — `passphrase`, `masterKey`, `derivedKey`, `keyEnvelope`, `keyValidatorBlob`, `kdfParams`, `kdfSpec`, `salt`, `iv`, `tag`, `ciphertext`, `secretFinding`, `secretAction`, `sanitizedText`, `pathSanitizerRule`, `entropyThreshold`, `auditEventId`, `secretAuditEntry`. Identico a docs/11. |

### B. Use cases trabajan con agregados/VOs del dominio — PASS

| Verificacion | Resultado |
|---|---|
| Inputs/outputs usan VOs (no primitivos crudos) | PASS — `Passphrase`, `KdfParams`, `DerivedKey`, `MasterKey`, `WorkspaceId`, `EncryptionConfig` (aggregate), `KeyEnvelope`, `KeyValidatorBlob`, `SecretFinding`, `SecretAction`, `SecretAuditEntry`, `SanitizedText`, `SanitizedPath`, `AuditEventId`. `grep "passphrase: string\|masterKey: string"` devuelve cero matches en application e infrastructure. |
| Boundaries documentadas para primitivos | PASS — Solo `workspaceRoot: string` en `InstallPreCommitHook` (input desde CLI antes de construir `SanitizedPath`, documentado en JSDoc). `text: string` en `ScanText` (input free-form a tokenizar). `rawPath: string` en `SanitizePath` (input a sanitizar). Todos justificados por boundary. |
| Aggregates se mutan via metodos | PASS — `EncryptionConfig.initialize(...)`, `unlockWith(...)`, `lock(...)`, `addEnvelope(...)`, `removeEnvelope(...)` (no setters libres). `SecretAuditEntry.record(...)` + immutable. Comprobado en `unlock-encryption.use-case.ts:99-105` y `initialize-encryption.use-case.ts:145-152`. |

### C. Repositorios trabajan con agregados completos — PASS

| Verificacion | Resultado |
|---|---|
| `SqliteSecretAuditRepository` reconstruye agregado | PASS — `parseRow(...)` valida con Zod, reconstruye `SecretFinding` (kind, position, confidence, source, detectedBy) via factories de domain, y devuelve `SecretAuditEntry.rehydrate(...)` (no DTO plano). |
| Encoding preserva semantica | PASS — `encodeFinding(...)` itera cada VO y llama a su accessor canonico (`.kind.toString()`, `.confidence.toNumber()`, etc.). Sin filtraciones de campos privados. |
| `EncryptionConfigRepository` trabaja con whole aggregate | PASS — Interfaz expone `findByWorkspace(WorkspaceId)` y `save(EncryptionConfig)`. Cero metodos parciales (`updateValidatorBlob`, `addEnvelope`). Adapter difere a workspace module por decision documentada. |
| Repos no aceptan predicados genericos | PASS — Cero `findByQuery(predicate)`. Solo `findById`, `findByWorkspace` (con limit), `save`. |

### D. Eventos en past tense — PASS

| Verificacion | Resultado |
|---|---|
| Eventos solo en `domain/events/` | PASS — `grep -r "extends DomainEvent\|implements DomainEvent"` en application/ e infrastructure/ devuelve cero matches. |
| Convencion `<module>.<past-tense-kebab>` | PASS — `encryption.initialized`, `encryption.unlocked`, `encryption.locked`, `encryption.key-envelope-added`, `encryption.key-envelope-removed`, `encryption.key-validation-failed`, `secrets.audit-entry-recorded`, `secrets.blocked`, `secrets.detected`, `secrets.redacted`. (Ver W-1 para nota sobre los `secrets.*`.) |
| Eventos inmutables | PASS — Verificado en Fase 1; los use cases solo los emiten via `aggregate.someMethod(...)` y los drenan con `pullEvents()`. `RecordSecretEventUseCase` retorna el aggregate para que el caller draine, mismo patron en `InitializeEncryptionUseCase`. |

### E. Anti-corruption layer (D-020) — PASS

**Archivo:** `code/src/modules/encryption/infrastructure/database/encryption-key-adapter.ts`

| Verificacion | Resultado |
|---|---|
| Conversion `MasterKey` → `EncryptionKeyBytes` aislada | PASS — `EncryptionKeyAdapter.toEncryptionKeyBytes(masterKey)` es el unico cruce documentado. Devuelve copia fresca via `masterKey.withBytes((bytes) => new Uint8Array(bytes))`. |
| `DerivedKey.bytes` no escapa | PASS — `grep "\.bytes\b"` en application/ e infrastructure/ devuelve cero matches. Todo acceso es via `.withBytes(callback)`. |
| Composition root responsable de cero-fill | PASS — Documentado en JSDoc del adapter ("Callers MUST zero-fill the buffer..."). |

### F. Coherencia con docs/11 (5 capas de defensa de secrets) — PASS

| Capa | Componente esperado | Implementacion validada |
|---|---|---|
| 1 — Pre-write detection (regex) | `PatternRegistry` (domain) + adapter | `BuiltInPatternRegistry` con 7 patrones canonicos de docs/11 §6 (AWS access, AWS secret, JWT, GitHub token, private key, password-in-URL, generic API key). |
| 1 — Pre-write detection (entropy) | `EntropyCalculator` (domain) + `EntropyThreshold` (VO) | `ShannonEntropyCalculator` adapter; `EntropyThreshold.defaultThreshold()` aporta el cutoff de 4.5 bits/char y `minimumLength()` (mirroring `docs/11 §6` "strings > 20 chars"). |
| 2 — Path sanitizer | `PathSanitizerRule` (VO) + `SanitizedPath` (VO) | `DefaultSecretsScanner.scanPath(...)` delega a `pathSanitizerRule.apply(rawPath)`. `SanitizePathUseCase` expone el flujo. |
| 3 — Modo encriptado | `EncryptionConfig` aggregate + AEAD adapters | Cobertura completa: init, unlock, lock; AES-GCM via Web Crypto. |
| 4 — Pre-commit hook | `PreCommitHookInstaller` (port) + adapter | `FilesystemPreCommitHookInstaller` con `MANAGED_HOOK_MARKER`, idempotencia (`already-managed`), guard contra hook foreigner. |
| 5 — Auditoria on-demand | `SecretAuditEntry` (aggregate) + repository | `SqliteSecretAuditRepository` append-only, `RecordSecretEventUseCase` mint+save+log. |

**Responsabilidad NO invertida:** los patrones (`SecretPattern`),
kinds (`SecretKind`), source-discrimination (`SecretSource`) y
sanitizer rule (`PathSanitizerRule`) viven en `domain/`. Los
adapters solo CONSUMEN. `BuiltInPatternRegistry` no inventa
patrones — usa `SecretPattern.create(...)` para cada uno con su
`DetectorName` y `SecretKind` desde domain. PASS.

### G. Errors tipados del dominio — PASS

| Verificacion | Resultado |
|---|---|
| Use cases lanzan/retornan errores tipados de domain | PASS — `EncryptionNotInitializedError`, `KeyValidationFailedError`, `WeakKdfParamsError`, `PathSanitizerError` (todos en `<module>/domain/errors/`). |
| Adapters lanzan `InfrastructureError` para operacionales | PASS — `EncryptionInfrastructureError` (base) → `KdfDerivationFailedError`, `AeadFailedError`, `RandomBytesError`. `SecretsInfrastructureError` (base) → `ForeignHookExistsError`. Hierarchy correcta: subclase de `shared/infrastructure/errors/infrastructure-error.ts`. |
| Distincion invariante vs operacional | PASS — `KeyValidationFailedError` es DOMAIN (user-visible "wrong key" → `-32108`); `AeadFailedError.kind=authentication-failed` es INFRA (caso "wrong key" detectado a nivel cipher) y se convierte a `KeyValidationFailedError` en el aggregate. Documentado explicitamente en JSDoc de ambos. |
| Application no importa de infrastructure/errors | PASS — `unlock-encryption.use-case.ts:176-182` detecta `AeadFailedError` por SHAPE (codigo + kind), evitando el import. Comentario explicito sobre la regla `docs/12 §1.1`. |

### Verificaciones tecnicas adicionales

| Test | Resultado |
|---|---|
| `grep` cross-module imports en application/infrastructure | PASS — Cero imports a `modules/<otro>/...`. Solo `shared/` y same-module domain. |
| `grep` setters publicos en aggregates | PASS — Cero matches `set [a-zA-Z]+\(` en application/infrastructure. |
| `grep` clases `Manager`/`Helper`/`Util`/`Service` generico | PASS — Cero matches. |
| `grep` interfaces con prefijo `I` | PASS — Cero matches. |
| Constructor publico en use cases | OK — Constructores publicos en clases de application son patron canonico (no son aggregates ni VOs); pretenden inyeccion de puertos via DI. |

---

## 5. Coherencia con HANDOFF §6.6 (decisiones del orquestador)

| Decision | Cumplimiento |
|---|---|
| D-018: `Argon2idKdf` en `modules/encryption/infrastructure/`, puerto `Kdf` en `modules/encryption/application/ports/` | PASS — Exactamente esa ubicacion. Documentado en el JSDoc del puerto. |
| D-019: TransactionManager omitido | PASS — Use cases usan `repository.save(aggregate)` directo; el adapter SQLite usa `db.transaction(fn)` interno cuando aplica. |
| D-020: `EncryptionKeyBytes` interfaz local en `SqliteDatabase` como ACL | PASS — `EncryptionKeyAdapter` es el unico lugar de conversion. JSDoc del adapter referencia D-020. |
| D-021: convencion `.port.ts` | PASS — Todos los puertos siguen el sufijo (`kdf.port.ts`, `random-bytes.port.ts`, `validator-encrypter.port.ts`, `pre-commit-hook-installer.port.ts`, etc.). |

---

## 6. Veredicto

**APPROVED — sin ciclos de rechazo.**

La implementacion de Tarea 3.2 (encryption + secrets,
application + infrastructure) por `crypto-security-expert` mantiene
coherencia DDD estricta con el dominio validado en Fase 1. Cero
hallazgos criticos. Tres warnings informativos (W-1 sobre convencion
de naming de eventos, W-2 sobre `Error` generico en
`findByWorkspace.limit` validation, W-3 sobre adapter de
`EncryptionConfigRepository` diferido a workspace) que no bloquean
Fase 3 y se pueden tratar en cleanups posteriores.

**Siguiente paso:** prosegir validaciones cruzadas
(`clean-architecture-validator`, `solid-validator`,
`security-auditor`, `performance-auditor`) sobre el mismo entregable.
