# Phase 4 — Task 4.6 — DDD Validator Report

**Task**: `JsonEncryptionConfigRepository` + `DestroyEncryptionUseCase`
**Validator**: `ddd-validator`
**Phase**: phase-4-application-infrastructure
**Verdict**: **APPROVED**

## Scope audited

- `code/src/modules/encryption/application/use-cases/destroy-encryption.use-case.ts`
- `code/src/modules/encryption/application/ports/in/destroy-encryption.port.ts`
- `code/src/modules/encryption/infrastructure/persistence/json-encryption-config-repository.ts`
- `code/src/modules/encryption/domain/events/encryption-destroyed.ts`
- `code/src/modules/encryption/infrastructure/errors/encryption-config-persistence-error.ts`
- Touched barrels: `domain/repositories/encryption-config-repository.ts`, `application/use-cases/index.ts`, `infrastructure/index.ts`.

## Findings per rule

### A. Lenguaje del dominio — PASS
- `DestroyEncryptionUseCase` / `DestroyEncryption` port → verbo de negocio explícito (`destroy`); coincide con la transición `encrypted → private` documentada en `docs/11 §5`.
- `JsonEncryptionConfigRepository` → puerto + tecnología (JSON), patrón consistente con `Argon2idKdf`, `AesGcmEnvelopeCipher`.
- `EncryptionDestroyed` → past tense + `eventName = "encryption.destroyed"` (kebab-case + namespace `encryption.*`); homogéneo con la familia (`encryption.initialized`, `.locked`, `.unlocked`, `.key-envelope-removed`).
- Ningún identificador genérico (`Item`, `Manager`, `Helper`, `Service`, `Handler`, `IRepository`).

### B. Use cases con aggregates/VOs del domain — PASS
- `DestroyEncryptionUseCase.destroy({ workspaceId: WorkspaceId, passphrase: Passphrase })` recibe VOs tipados; sin `string`/`number` crudos para conceptos de negocio.
- Carga el aggregate completo vía `repository.findByWorkspace(input.workspaceId)`; ramifica en `EncryptionNotInitializedError` ante `null`.
- No realiza mutaciones parciales del aggregate. Itera `config.getEnvelopes()` y consulta `config.getKeyValidatorBlob()` para validar autoridad; tras eso, `repository.delete(workspaceId)` borra atómicamente. El aggregate se descarta sin emitir `EncryptionLocked` redundante (decisión documentada en JSDoc).

### C. Repositorios con aggregates completos — PASS
- `EncryptionConfigRepository` (puerto, `domain/repositories/`) define `findByWorkspace`, `save`, `delete`. No hay queries genéricos (`findByQuery(predicate)`).
- `findByWorkspace` rehidrata el aggregate vía `EncryptionConfig.rehydrate({...})` reconstruyendo todos los VOs (`KdfSpec`, `KeyValidatorBlob`, `KeyEnvelope[]`, `Timestamp`, `WorkspaceId`).
- Validación Zod estricta (`ENCRYPTION_SLICE_SCHEMA`, `KEY_ENVELOPE_SCHEMA`, `KDF_PARAMS_SCHEMA`, `ENVELOPE_AEAD_SCHEMA`); además cross-check del `workspace_id` embebido contra el solicitado.
- `save` persiste el aggregate completo, fusionando contra el `config.json` existente (`looseObject` preserva slices ajenas verbatim).
- Operaciones `async` y devuelven `Promise`.

### D. Eventos — PASS
- `EncryptionDestroyed` payload: `{ workspaceId: WorkspaceId, occurredAt: Timestamp, eventName: "encryption.destroyed" }`. Sólo metadata pública.
- Props `readonly`, past-tense, kebab-case, namespace `encryption.*`. Implementa `DomainEvent` de `shared/domain/types/`.
- JSDoc explícito sobre invariantes de seguridad (no passphrase, no derived key, no master key, no validator plaintext).

### E. Anti-corruption layer — PASS
- `fromAggregate` serializa únicamente material público: base64 de `KeyEnvelope.encryptedMasterKey` (iv/ciphertext/tag), base64 de `KeyValidatorBlob` (iv/ciphertext/tag), `kdfSpec.params.salt`, `kdfSpec.algorithm`, `keyId`, `label`, timestamps. El acceso a bytes pasa por los métodos `withIv/withCiphertext/withTag` que devuelven copias defensivas — disciplinas establecidas por las VOs.
- En ningún punto se intenta serializar `MasterKey.bytes`, `DerivedKey.bytes` ni el `unlockedKey` runtime (la repo nota explícita en `domain/repositories/...` lo prohíbe).
- `toAggregate` reconstruye sólo desde la sección encriptación verificada.

### F. Errores tipados — PASS
- `EncryptionConfigPersistenceError extends EncryptionInfrastructureError` con discriminator `kind` ∈ `{ "read-failed", "malformed", "write-failed", "path-traversal" }` y `code = "crypto.encryption-config-persistence-failed"`.
- Factories estáticas (`readFailed`, `malformed`, `writeFailed`, `pathTraversal`); `private constructor`; `isKind` discriminator helper.
- Los `throw new Error(...)` en `fromBase64` (líneas 708/711/718/726) son helpers privados cuyas excepciones SIEMPRE se capturan en los `parseKdfParams/parseValidatorBlob/parseEnvelope` (líneas 599-614 / 621-640 / 647-688) y se reescriben como `EncryptionConfigPersistenceError.malformed(...)`. Patrón aceptable: error tipado en el límite público.
- `EncryptionNotInitializedError` y `KeyValidationFailedError` son del dominio y devueltos en el canal `Result`.

### G. Repositorio: contrato `delete` — PASS
- **Idempotencia**: `delete` cuando no hay `config.json` o no hay slice de encryption es no-op (sin error, log informativo con `outcome: "no-config-file"` o `"no-encryption-slice"`). El caso "fichero existe pero sin slice" se distingue del "fichero ausente" en el log (cumple lo solicitado en el JSDoc).
- **Atomicidad**: implementación documentada y aplicada en `writeAtomic` (write-temp con sufijo `process.pid + Date.now()` + `chmod 0o600` + `rename` atómico POSIX/Windows). Cleanup best-effort del temp en fallo.
- **No-cross-cutting**: `delete` preserva todas las slices ajenas (workspace, embedder, secrets, retrieval, curator) iterando con un `Set` de claves "owned" en lugar del operador `delete` (ESLint `@typescript-eslint/no-dynamic-delete`).
- JSDoc del puerto cubre todos los casos: ausencia → no-op, atomicidad obligatoria, no tocar SQLCipher.

### H. Reuse del flow `Unlock` — PASS
- `DestroyEncryptionUseCase.tryUnwrap` y `isAuthenticationFailure` espejan exactamente `UnlockEncryptionUseCase.tryUnwrap` (reusando `Kdf` + `EnvelopeCipher`). La duplicación es deliberada (helper privado por use case) y está documentada en JSDoc para preservar use-cases auto-contenidos.
- La autoridad criptográfica se delega al servicio de dominio `KeyValidator.validate(blob, candidate)`, que internamente usa `KeyValidatorBlob.matches` (constant-time). El use case NO reimplementa la comparación: respeta a `KeyValidatorBlob` como única fuente de verdad para "¿es esta la clave correcta?".
- Diferencia justificada vs `Unlock`: destroy no llama a `EncryptionConfig.unlockWith(...)` porque (1) el aggregate va a ser destruido, (2) no debe quedar en estado `unlocked` ni emitir `EncryptionUnlocked`, y (3) el JSDoc del use case explica que un `unlocked` runtime previo NO es prueba suficiente para una operación irrecuperable. La invocación directa a `keyValidator.validate(...)` mantiene la autoridad en el VO/servicio sin manipular estado del aggregate.

### Otros checks transversales
- VOs/aggregates conservan `private constructor` + factories. No setters públicos. Igualdad por `equals(...)` en VOs.
- `domain/` no tiene imports de paquetes externos (ni de infra ni de application). El use case importa sólo `shared/...` y `encryption/domain/...` y sus propios ports.
- Barrels actualizados: `application/use-cases/index.ts`, `infrastructure/index.ts` exportan los nuevos símbolos. (`application/ports/in/index.ts` no existe en el módulo — patrón coherente con el resto del proyecto, no es violación.)

## Veredicto final

**APPROVED**. La Tarea 4.6 cumple en su totalidad las reglas R1–R7 del lineamiento §1.2 y los requisitos de `docs/11-seguridad-modos.md` (modos, validator blob, transición `encrypted → private`). Cero hallazgos críticos. Cero hallazgos menores que bloqueen merge. La duplicación voluntaria de `tryUnwrap` está justificada y documentada. El contrato del repositorio (idempotencia, atomicidad, anti-corruption) está cubierto a nivel código y JSDoc.
