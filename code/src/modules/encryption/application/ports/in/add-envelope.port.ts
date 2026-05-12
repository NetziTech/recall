import type { Timestamp } from "../../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../../shared/domain/value-objects/workspace-id.ts";
import type { KeyId } from "../../../domain/value-objects/key-id.ts";
import type { KeyLabel } from "../../../domain/value-objects/key-label.ts";
import type { Passphrase } from "../../../domain/value-objects/passphrase.ts";

/**
 * Input contract for {@link AddEnvelope}.
 *
 * - `workspaceId` identifies the encrypted workspace whose envelope
 *   list will gain a new entry. The aggregate is loaded by this id,
 *   and the use case refuses to operate on workspaces whose
 *   encryption config does not exist (`shared` / `private` modes).
 * - `newPassphrase` is the secondary passphrase the user wants to
 *   register. It is fed to the KDF (with a freshly minted salt) to
 *   derive the encryption key that will AEAD-wrap the SAME master
 *   key the workspace is already unlocked with.
 * - `label` is the optional human-readable identifier shown by
 *   `recall add-key --list`. Inherits the invariants of {@link
 *   KeyLabel} (trimmed, non-empty, single-line, length-capped).
 *
 * Pre-conditions enforced by the use case (NON-NEGOTIABLE):
 * - The encryption config for `workspaceId` MUST exist.
 * - The encryption config MUST be unlocked (`config.isUnlocked()
 *   === true`). The composition root is responsible for invoking
 *   `UnlockEncryption.unlock(...)` BEFORE calling this use case;
 *   ADR-005 Q1 pins the "current passphrase" prompt at the CLI
 *   prompt layer, NOT inside this use case.
 */
export interface AddEnvelopeInput {
  readonly workspaceId: WorkspaceId;
  /**
   * Passphrase that opens the currently-active envelope. The use case
   * delegates unlock to {@link UnlockEncryption} internally so the
   * fresh aggregate loaded from `EncryptionConfigRepository` becomes
   * unlocked-in-memory before the new envelope is appended. Required
   * because aggregates are rebuilt from `config.json` on every load
   * (the unlocked master key never persists to disk).
   */
  readonly currentPassphrase: Passphrase;
  readonly newPassphrase: Passphrase;
  readonly label: KeyLabel | null;
}

/**
 * Output contract for {@link AddEnvelope}.
 *
 * - `envelopeId` is the freshly minted `KeyId` of the new envelope
 *   appended to the multi-key list.
 * - `addedAt` is the canonical timestamp stored on the envelope's
 *   `createdAt` and reused as the audit-log row's `occurred_at_ms`.
 */
export interface AddEnvelopeOutput {
  readonly envelopeId: KeyId;
  readonly addedAt: Timestamp;
}

/**
 * Driving (input) port: append a secondary `KeyEnvelope` to an
 * already-unlocked encrypted workspace.
 *
 * **Source-of-truth: ADR-005 (Phase-22, `docs/12-lineamientos-arquitectura.md`
 * §1.5.5 appendix)**. The multi-key flow lets a team register
 * additional passphrases without rekeying the master key: each
 * envelope wraps the SAME master key under a DIFFERENT passphrase
 * (`docs/11-seguridad-modos.md` §7 "Multi-key (v0.5+)").
 *
 * Flow:
 * 1. Load the `EncryptionConfig` aggregate by `workspaceId`. Refuse
 *    if absent (`EncryptionNotInitializedError`) or locked
 *    (`EncryptionLockedError`).
 * 2. Mint fresh material for the new envelope: a CSPRNG salt and a
 *    `KdfParams` instance using project defaults.
 * 3. Derive a new `DerivedKey` from `newPassphrase` + the fresh salt
 *    via the injected `Kdf` port.
 * 4. AEAD-wrap the currently-unlocked master key with the derived
 *    key via the injected `EnvelopeCipher`, producing the
 *    envelope's `EncryptedMasterKey`.
 * 5. Build the new `KeyEnvelope` VO (fresh `KeyId` via the shared
 *    `IdGenerator` port) and append it to the aggregate via
 *    `EncryptionConfig.addEnvelope({...})`. The aggregate rejects
 *    inconsistent master-key wrapping with `MasterKeyMismatchError`.
 * 6. Persist the aggregate via `EncryptionConfigRepository.save`.
 * 7. Append two audit events to `encryption_audit_log`:
 *    `UnlockSucceeded` (records the master-key fingerprint in scope
 *    at the time of the add) and `KeyEnvelopeAdded` (records the
 *    new envelope id under the same fingerprint).
 *
 * Atomicity (ADR-005 Q4 limitation):
 * - SQLite transactions in this codebase are SYNCHRONOUS
 *   (`DatabaseConnection.transaction<T>(fn: () => T): T`), but the
 *   wrap / unwrap / KDF operations are async. The use case therefore
 *   commits the filesystem-side persistence FIRST (config.json),
 *   then batches the two audit-log appends inside a single
 *   synchronous `transaction(() => { ... })` so that they are
 *   either both visible or neither — same-transaction atomicity for
 *   the audit pair.
 * - Residual risk window: if the audit batch fails AFTER `save`
 *   succeeds, the envelope is persisted but the audit log lacks
 *   the two rows. This is documented as the lesser-evil branch in
 *   the ADR appendix: the envelope is the user-visible state, the
 *   audit is the forensic trail; losing the trail is recoverable
 *   (operators run `recall audit` and see the gap), losing the
 *   envelope would break the multi-key promise.
 *
 * Failure modes (THROWN — no Result channel):
 * - `EncryptionNotInitializedError` — workspace has no encryption
 *   config (mode `shared` / `private`).
 * - `EncryptionLockedError` — workspace's encryption aggregate is
 *   locked; the composition root must run unlock BEFORE this use
 *   case.
 * - `MasterKeyMismatchError` — defensive, raised by the aggregate if
 *   the wrap/unwrap round-trip recovers a key that does not match
 *   the currently-unlocked one. Effectively unreachable when the
 *   use case wraps the SAME `MasterKey` reference held by the
 *   aggregate (we do not re-derive it from disk); the aggregate
 *   still enforces the invariant as defence-in-depth.
 * - `InfrastructureError` subclasses (`KdfDerivationFailedError`,
 *   `AeadFailedError`, `RandomBytesError`, ...) — propagated
 *   unchanged.
 *
 * Why this port lives in `application/ports/in/`:
 * - It is the driving port the CLI's `AddKeyFacade` adapter
 *   invokes. The aggregate's `addEnvelope` method is a *domain
 *   primitive*; this port is the *application-level orchestration*
 *   that puts the KDF / cipher / repository / audit-log together.
 */
export interface AddEnvelope {
  addEnvelope(input: AddEnvelopeInput): Promise<AddEnvelopeOutput>;
}
