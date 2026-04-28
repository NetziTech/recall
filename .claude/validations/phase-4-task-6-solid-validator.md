# Phase 4 — Task 4.6 — solid-validator

## Verdict: APPROVED

## Scope audited

New files:
- `code/src/modules/encryption/infrastructure/persistence/json-encryption-config-repository.ts`
- `code/src/modules/encryption/infrastructure/errors/encryption-config-persistence-error.ts`
- `code/src/modules/encryption/application/use-cases/destroy-encryption.use-case.ts`
- `code/src/modules/encryption/application/ports/in/destroy-encryption.port.ts`
- `code/src/modules/encryption/domain/events/encryption-destroyed.ts`

Modified files:
- `code/src/modules/encryption/application/use-cases/index.ts`
- `code/src/modules/encryption/application/ports/index.ts`
- `code/src/modules/encryption/infrastructure/index.ts`
- `code/src/composition/persistence/pending-encryption-config-repository.ts`
- (composition wiring, not in audit scope)

## A. SOLID

### SRP — APPROVED
- `JsonEncryptionConfigRepository` (~740 LOC, justified by JSON parsing + base64 + atomic write helpers, all cohesively serving the single "persist encryption slice of config.json" responsibility). Helpers (`parseAlgorithm`, `parseKdfParams`, `parseValidatorBlob`, `parseEnvelope`, `kdfParamsToJson`, `fromBase64`, `toBase64`) are static / module-private and tightly coupled to that responsibility.
- `DestroyEncryptionUseCase`: single responsibility = orchestrate destroy flow (find, re-authorize, delete, emit). Private `tryUnwrap` + `isAuthenticationFailure` are internal collaborators of the same workflow.
- `EncryptionConfigPersistenceError`: single responsibility = typed I/O failure with discriminated union of kinds.
- `EncryptionDestroyed`: single responsibility = past-tense fact carrier.
- `DestroyEncryption` port: single contract.

### OCP — APPROVED
- `EncryptionConfigRepository` keeps its 3 cohesive verbs (`findByWorkspace`, `save`, `delete`). No `kind` dispatch in the repo or use case.
- The use case loops envelopes polymorphically via `tryUnwrap`; no `if (algorithm === ...)` branching at use-case level.
- `KdfAlgorithm.create` is the single VO that catalogues algorithms; the adapter delegates and rethrows as `malformed`. No central switch.
- `EncryptionConfigPersistenceError` exposes static factories (`readFailed`, `malformed`, `writeFailed`, `pathTraversal`) — adding a new kind requires adding a new factory + extending the `as const` array; no central switch to mutate.
- The destroy flow uses `KeyValidationFailedError` and `EncryptionNotInitializedError` from the domain; new error variants would extend the Result-type union without rewriting branches (the use case's exhaustive handling is `null`-check + early return, not `kind`-dispatch).

### LSP — APPROVED
- `JsonEncryptionConfigRepository` honours the interface: `findByWorkspace` returns `Promise<EncryptionConfig | null>` (null on absence, throws `EncryptionConfigPersistenceError` only on infra failures, matching the port's documented contract that it throws on I/O misbehavior, not on absence).
- `PendingEncryptionConfigRepository.delete()` now exists; lazy-rejects with `EncryptionConfigRepositoryPendingError("delete")` — same shape as the other two methods. Subtypes are mutually substitutable as documented stubs.
- `delete` is documented as idempotent and the JSON adapter implements idempotence (no `removedAnything` → silent return, no `existing` → silent return). Postcondition holds.

### ISP — APPROVED
- Repository: 3 methods, all cohesive. No client forced to no-op a method.
- `DestroyEncryption` port: single method (`destroy`).
- Use case pulls only the dependencies it uses (`Kdf`, `EnvelopeCipher`, `KeyValidator`, `Clock`, `Logger`, `publishEvent`, `EncryptionConfigRepository`).

### DIP — APPROVED
- `DestroyEncryptionUseCase` constructor injects all 7 ports/services. Zero `new SomeAdapter()` calls inside.
- `JsonEncryptionConfigRepository` constructor receives `workspaceRoot`, `clock`, `logger` — pure data + ports. No internal instantiation of foreign adapters.
- Stub repository: pure types + Promise.reject; no instantiation chain.
- The use case imports `EncryptionConfigRepository` as a `type` from `domain/repositories/`, never a concrete class.

## B. Type-safety

1. **`grep ": any | as any | <any>"` in scope:** 2 matches, both inside JSDoc text ("any other thrown exception"); zero actual type usages. Cero `any` confirmed.
2. **`grep "ts-ignore | ts-expect-error"`:** zero matches.
3. **`npx tsc --noEmit`:** EXIT 0, no output.
4. **`npm run lint`:** EXIT 0, `--max-warnings 0` passed.
5. **Explicit return types:** confirmed on all public/private methods of the new classes (`Promise<EncryptionConfig | null>`, `Promise<void>`, `Promise<MasterKey | null>`, `boolean`, `string`, etc.). Constructors typed; static factories typed.
6. **Zod validation in JSON.parse boundary:** `readJsonOrNull` returns `unknown`; downstream parses it via `FULL_CONFIG_SCHEMA.safeParse` and `ENCRYPTION_SLICE_SCHEMA.safeParse`. The single visible cast is `(existing as RawConfig)` AFTER `typeof === "object" && !Array.isArray(...)` narrowing — that is a structural narrow on `unknown`, NOT bypassing schema validation (the encryption fields touched by `save`/`delete` are owned by the adapter and merged on top; non-encryption keys round-trip verbatim, which is the `looseObject` contract). The `JSON.parse(raw) as unknown` is the canonical idiom (parse always typed `any` in lib.d.ts; casting to `unknown` is safer, not weaker).
7. **Discriminated union in `EncryptionConfigPersistenceError`:** kinds `"read-failed" | "malformed" | "write-failed" | "path-traversal"` declared via `as const` array → derived type. `kind: EncryptionConfigPersistenceKind` field. `isKind` type predicate. Static factories one-per-kind. All requested kinds present.

## C. `.port.ts` convention — APPROVED
- `destroy-encryption.port.ts` lives under `application/ports/in/`, suffix correct, alongside the other 4 input ports.

## D. AEAD failure closure in `DestroyEncryption` — APPROVED
- The use case catches `tryUnwrap` errors and routes through `isAuthenticationFailure(cause)`. The check inspects the structural fields `code === "crypto.aead-failed"` AND `kind === "authentication-failed"` — these ARE the discriminated-union tags of `AeadFailedError` (kinds: `authentication-failed | subtle-not-available | library-failure | invalid-buffer-size`). Mirrors `UnlockEncryptionUseCase.isAuthenticationFailure` verbatim.
- This is intentionally NOT `instanceof AeadFailedError` to honour `docs/12 §1.1` (application MUST NOT import from infrastructure). The structural check on the published, stable `code` + `kind` contract is the correct cross-layer pattern. Not "fragile string matching" — it tests the documented public discriminator of the infra error.
- All other AEAD `kind`s rethrow (correct, per port docs: those are unrecoverable `InfrastructureError`).
- `KdfDerivationFailedError` from `kdf.derive` rethrown unchanged — correct.

## E. Stub extended — APPROVED
- `PendingEncryptionConfigRepository.delete(_workspaceId)` returns `Promise.reject(new EncryptionConfigRepositoryPendingError("delete"))`. Same exact shape as `findByWorkspace` and `save`. Single instance of the error class is constructed per call (matches the doc "subscribers can hold a stable reference to the typed error").

## Critical issues: 0
## Major issues: 0
## Minor observations
- (Non-blocking) `JsonEncryptionConfigRepository.toAggregate` uses a `for...of` with `envelopes.push(...)` instead of `slice.key_envelopes.map(...)`; both are equivalent and the `for` form makes the per-iteration error context (`workspaceRoot`) trivially close over each call. No action required.
- (Non-blocking) The `parseEnvelope` helper hard-codes `KdfAlgorithm.argon2id()` per-envelope and the JSDoc explicitly flags the future-extension point; this is forward-looking documentation, not a violation today.

## Verdict (≤200 words)

APPROVED. Cero `any`, cero `ts-ignore`, `tsc --noEmit` y `npm run lint` exit 0. SOLID limpio: SRP cohesivo en repo (740 LOC justificadas por helpers de parsing/base64/atomic write todos sirviendo la misma responsabilidad), use case (orquestación destroy) y error tipado. OCP respetado: tres verbos cohesivos en repo, sin switch sobre `kind`. LSP correcto: `JsonEncryptionConfigRepository` honra contrato del puerto (null en ausencia, throws solo en I/O); `PendingEncryptionConfigRepository.delete()` ahora rechaza con el mismo patrón que `findByWorkspace`/`save`. ISP: 3 métodos, ningún cliente forzado. DIP: `DestroyEncryptionUseCase` inyecta los 7 colaboradores por constructor; `JsonEncryptionConfigRepository` recibe `workspaceRoot`/`clock`/`logger`. Type-safety: Zod schema (`FULL_CONFIG_SCHEMA` + `ENCRYPTION_SLICE_SCHEMA`) valida el output de `JSON.parse` antes de tocarlo; cero `as Type` sobre el output crudo. Discriminated union completa en `EncryptionConfigPersistenceError` (`read-failed`/`malformed`/`write-failed`/`path-traversal`). El branching AEAD (`isAuthenticationFailure`) inspecciona los discriminadores públicos `code` + `kind` — patrón cross-layer correcto, no string matching frágil. Sufijo `.port.ts` correcto. Lista para fase 4.7.
