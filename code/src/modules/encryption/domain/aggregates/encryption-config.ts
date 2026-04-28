import type { DomainEvent } from "../../../../shared/domain/types/domain-event.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import { EncryptionNotInitializedError } from "../errors/encryption-not-initialized-error.ts";
import { KeyValidationFailedError } from "../errors/key-validation-failed-error.ts";
import { LastEnvelopeRemovalError } from "../errors/last-envelope-removal-error.ts";
import { MasterKeyMismatchError } from "../errors/master-key-mismatch-error.ts";
import { EncryptionInitialized } from "../events/encryption-initialized.ts";
import { EncryptionLocked } from "../events/encryption-locked.ts";
import { EncryptionUnlocked } from "../events/encryption-unlocked.ts";
import { KeyEnvelopeAdded } from "../events/key-envelope-added.ts";
import { KeyEnvelopeRemoved } from "../events/key-envelope-removed.ts";
import { KeyValidationFailed } from "../events/key-validation-failed.ts";
import type { KeyValidator } from "../services/key-validator.ts";
import type { KdfSpec } from "../value-objects/kdf-spec.ts";
import type { KeyEnvelope } from "../value-objects/key-envelope.ts";
import type { KeyId } from "../value-objects/key-id.ts";
import type { KeyValidatorBlob } from "../value-objects/key-validator-blob.ts";
import type { MasterKey } from "../value-objects/master-key.ts";
import { InvariantViolationError } from "../../../../shared/domain/errors/invariant-violation-error.ts";

/**
 * Aggregate root for the `encryption` bounded context.
 *
 * `EncryptionConfig` models the persistent slice documented in
 * `docs/03-modelo-datos.md` §2 ("Campos especificos del modo
 * encrypted") plus the runtime-only "is the workspace currently
 * unlocked?" state. Identity is the `WorkspaceId` because there is
 * exactly one encryption config per encrypted workspace (a
 * one-to-one composition: `Workspace.mode === "encrypted"` iff a
 * sibling `EncryptionConfig` exists).
 *
 * State:
 * - `workspaceId`: identity (immutable).
 * - `kdfSpec`: the algorithm + params used to derive keys from
 *   passphrases. Currently constant per workspace; rotating requires
 *   re-deriving every envelope, which is a flow we do not yet
 *   model in the domain (see `mcp-memoria rekey` in
 *   `docs/11-seguridad-modos.md` §7).
 * - `keyValidatorBlob`: the AEAD blob that lets `unlockWith`
 *   verify a candidate master key without opening the SQLCipher
 *   database (`docs/11-seguridad-modos.md` §7).
 * - `envelopes`: the list of `KeyEnvelope` instances, each wrapping
 *   the same master key with a different passphrase. Persisted in
 *   `config.json → key_envelopes`.
 * - `createdAt`, `updatedAt`: lifecycle timestamps.
 * - `unlockedKey`: runtime-only. NOT persisted. Set by
 *   `unlockWith(...)`, cleared by `lock()`.
 *
 * Invariants:
 * - Identity is immutable: `getWorkspaceId()` is stable for the
 *   entire lifetime.
 * - `envelopes.length >= 1` after `initialize(...)`. The aggregate
 *   refuses any operation that would drop it to zero
 *   (`LastEnvelopeRemovalError`).
 * - Every envelope wraps the SAME master key. Enforced at
 *   `addEnvelope(...)` time via `MasterKeyMismatchError`.
 * - `unlockedKey !== null` implies the master key it holds
 *   correctly decrypts `keyValidatorBlob`. Enforced at
 *   `unlockWith(...)` time via the injected `KeyValidator` service.
 * - The `unlockedKey` field is never persisted; the repository
 *   contract excludes it.
 *
 * Security:
 * - `unlockedKey` is held as a `MasterKey` VO, whose `toString` /
 *   `toJSON` are redacted by construction.
 * - The aggregate NEVER returns the `MasterKey` via a getter that
 *   would let callers serialize it. The supported access path is
 *   `withUnlockedKey(callback)`, which delegates to the VO's own
 *   `withBytes` discipline.
 *
 * Persistence:
 * - The repository (`EncryptionConfigRepository`) reads/writes
 *   `kdfSpec`, `keyValidatorBlob`, `envelopes`, `createdAt`,
 *   `updatedAt`. It MUST NOT touch `unlockedKey`.
 * - Events buffered in the aggregate are NOT consumed by the
 *   repository. The application layer drains them via
 *   `pullEvents()` after `save` succeeds.
 */
export class EncryptionConfig {
  private readonly workspaceId: WorkspaceId;
  private readonly kdfSpec: KdfSpec;
  private readonly keyValidatorBlob: KeyValidatorBlob;
  private envelopes: KeyEnvelope[];
  private readonly createdAt: Timestamp;
  private updatedAt: Timestamp;
  private unlockedKey: MasterKey | null;
  private readonly events: DomainEvent[];

  private constructor(input: {
    workspaceId: WorkspaceId;
    kdfSpec: KdfSpec;
    keyValidatorBlob: KeyValidatorBlob;
    envelopes: readonly KeyEnvelope[];
    createdAt: Timestamp;
    updatedAt: Timestamp;
    unlockedKey: MasterKey | null;
    events: readonly DomainEvent[];
  }) {
    this.workspaceId = input.workspaceId;
    this.kdfSpec = input.kdfSpec;
    this.keyValidatorBlob = input.keyValidatorBlob;
    // Defensive copy: the constructor accepts a `readonly` view but
    // owns a mutable list internally so add/remove can mutate it.
    this.envelopes = [...input.envelopes];
    this.createdAt = input.createdAt;
    this.updatedAt = input.updatedAt;
    this.unlockedKey = input.unlockedKey;
    this.events = [...input.events];
  }

  // -- factories -----------------------------------------------------------

  /**
   * Brings a brand-new `EncryptionConfig` into existence. Called by
   * the `mem.init({ mode: "encrypted" })` use case after the
   * infrastructure layer has:
   *
   * 1. Generated a fresh master key (CSPRNG, 32 bytes).
   * 2. Generated a fresh salt for the first envelope (CSPRNG, >= 16
   *    bytes) and built a `KdfSpec`.
   * 3. Derived the user's first passphrase into a `DerivedKey`.
   * 4. Wrapped the master key with the derived key into a
   *    `KeyEnvelope`.
   * 5. Encrypted the validator sentinel into a `KeyValidatorBlob`.
   *
   * Emits `EncryptionInitialized`. The aggregate starts UNLOCKED
   * (the master key is right there in the caller's hand) — the
   * application layer can choose whether to call `lock()`
   * immediately or keep the key resident for the rest of the
   * session.
   */
  public static initialize(input: {
    workspaceId: WorkspaceId;
    masterKey: MasterKey;
    firstEnvelope: KeyEnvelope;
    kdfSpec: KdfSpec;
    validatorBlob: KeyValidatorBlob;
    occurredAt: Timestamp;
  }): EncryptionConfig {
    const event = new EncryptionInitialized({
      workspaceId: input.workspaceId,
      kdfAlgorithm: input.kdfSpec.algorithm,
      firstKeyId: input.firstEnvelope.keyId,
      occurredAt: input.occurredAt,
    });
    return new EncryptionConfig({
      workspaceId: input.workspaceId,
      kdfSpec: input.kdfSpec,
      keyValidatorBlob: input.validatorBlob,
      envelopes: [input.firstEnvelope],
      createdAt: input.occurredAt,
      updatedAt: input.occurredAt,
      unlockedKey: input.masterKey,
      events: [event],
    });
  }

  /**
   * Rehydrates an `EncryptionConfig` from previously-persisted
   * state. Used by the repository when reading `config.json`. Does
   * NOT emit any event (no business fact is happening).
   *
   * The aggregate starts LOCKED (`unlockedKey: null`) regardless of
   * any cached key on disk: the application layer is responsible
   * for calling `unlockWith(...)` if it has a key in HOME.
   */
  public static rehydrate(input: {
    workspaceId: WorkspaceId;
    kdfSpec: KdfSpec;
    keyValidatorBlob: KeyValidatorBlob;
    envelopes: readonly KeyEnvelope[];
    createdAt: Timestamp;
    updatedAt: Timestamp;
  }): EncryptionConfig {
    if (input.envelopes.length === 0) {
      throw new InvariantViolationError(
        `cannot rehydrate encryption config for workspace ${input.workspaceId.toString()}: at least one key envelope is required`,
        { invariant: "encryption.envelopes.non-empty" },
      );
    }
    return new EncryptionConfig({
      workspaceId: input.workspaceId,
      kdfSpec: input.kdfSpec,
      keyValidatorBlob: input.keyValidatorBlob,
      envelopes: [...input.envelopes],
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
      unlockedKey: null,
      events: [],
    });
  }

  /**
   * Always throws `EncryptionNotInitializedError` carrying this
   * aggregate's workspace id.
   *
   * Mirror of `Workspace.rejectReinitialization`: callable by use
   * cases that have already detected (typically via the repository
   * returning `null`) that no encryption config exists, and want
   * the rejection wording centralized. The application layer
   * receives a typed error it can surface verbatim instead of
   * having to invent its own.
   */
  public static rejectMissing(workspaceId: WorkspaceId): never {
    throw new EncryptionNotInitializedError(workspaceId);
  }

  // -- mutations -----------------------------------------------------------

  /**
   * Adds a new `KeyEnvelope` to the multi-key list.
   *
   * The application layer is responsible for:
   * 1. Generating a fresh `keyId` (UUID v7).
   * 2. Asking the user for the new passphrase, deriving a
   *    `DerivedKey` from it.
   * 3. Wrapping the SAME master key currently unlocking this
   *    config with the new derived key, producing the envelope's
   *    `EncryptedMasterKey`.
   * 4. Decoding the wrapped key back (i.e. `EnvelopeCipher.unwrap`)
   *    to obtain the candidate master key, and passing it as
   *    `unwrappedMasterKey` so the aggregate can verify it matches
   *    the currently held one.
   *
   * Step 4 is the *invariant gate*: without it, a buggy or
   * malicious caller could add an envelope wrapping a *different*
   * master key, leaving the workspace in a state where some
   * envelopes open the database and others don't. The aggregate
   * refuses that with `MasterKeyMismatchError`.
   *
   * Pre-conditions:
   * - The aggregate MUST be unlocked (`isUnlocked() === true`). The
   *   currently held master key is the reference for the mismatch
   *   check.
   * - The `keyId` must not already exist in `envelopes`.
   *
   * Emits `KeyEnvelopeAdded`.
   */
  public addEnvelope(input: {
    envelope: KeyEnvelope;
    unwrappedMasterKey: MasterKey;
    occurredAt: Timestamp;
  }): void {
    if (this.unlockedKey === null) {
      throw new InvariantViolationError(
        `cannot add a key envelope to a locked encryption config (workspace ${this.workspaceId.toString()})`,
        { invariant: "encryption.add-envelope.requires-unlocked" },
      );
    }
    if (this.findEnvelopeIndex(input.envelope.keyId) !== -1) {
      throw new InvariantViolationError(
        `key envelope ${input.envelope.keyId.toString()} already exists in workspace ${this.workspaceId.toString()}`,
        { invariant: "encryption.envelopes.unique-id" },
      );
    }
    if (!this.unlockedKey.equals(input.unwrappedMasterKey)) {
      throw new MasterKeyMismatchError(input.envelope.keyId);
    }

    this.envelopes.push(input.envelope);
    this.updatedAt = input.occurredAt;
    this.events.push(
      new KeyEnvelopeAdded({
        workspaceId: this.workspaceId,
        keyId: input.envelope.keyId,
        label: input.envelope.label,
        occurredAt: input.occurredAt,
      }),
    );
  }

  /**
   * Removes the envelope identified by `keyId` from the multi-key
   * list.
   *
   * Refuses:
   * - Removing an envelope that does not exist (silently no-op
   *   would mask bugs).
   * - Removing the last remaining envelope
   *   (`LastEnvelopeRemovalError`): the workspace would become
   *   permanently unrecoverable.
   *
   * Does NOT require the aggregate to be unlocked: revoking a
   * compromised key is a security operation that should remain
   * available even when the on-call operator has no copy of the
   * current master key (the rotation flow in
   * `docs/11-seguridad-modos.md` §7 still produces the new
   * envelope first; this method is the second half).
   *
   * Emits `KeyEnvelopeRemoved`.
   */
  public removeEnvelope(input: {
    keyId: KeyId;
    occurredAt: Timestamp;
  }): void {
    const index = this.findEnvelopeIndex(input.keyId);
    if (index === -1) {
      throw new InvariantViolationError(
        `key envelope ${input.keyId.toString()} does not exist in workspace ${this.workspaceId.toString()}`,
        { invariant: "encryption.envelopes.exists" },
      );
    }
    if (this.envelopes.length === 1) {
      throw new LastEnvelopeRemovalError(input.keyId);
    }
    this.envelopes.splice(index, 1);
    this.updatedAt = input.occurredAt;
    this.events.push(
      new KeyEnvelopeRemoved({
        workspaceId: this.workspaceId,
        keyId: input.keyId,
        occurredAt: input.occurredAt,
      }),
    );
  }

  /**
   * Verifies that the supplied `candidate` master key correctly
   * decrypts the workspace's `KeyValidatorBlob`, and on success
   * stores it as the in-memory unlocked key.
   *
   * The application layer is responsible for producing the
   * candidate: typically by selecting an envelope from `envelopes`
   * (matched on `keyId` from a stored cache, or attempted in
   * order), deriving a `DerivedKey` from the user's passphrase,
   * and unwrapping the envelope. The resulting master key is then
   * passed here.
   *
   * The validation itself is delegated to the injected
   * `KeyValidator` adapter (the AEAD primitive, the expected
   * sentinel byte-comparison) so the domain stays free of
   * cryptographic dependencies. The aggregate only owns the
   * *policy*: "validate, then store, and emit either the success
   * or the failure event".
   *
   * On success:
   * - Stores `candidate` as `unlockedKey`.
   * - Emits `EncryptionUnlocked`.
   *
   * On failure:
   * - Emits `KeyValidationFailed` (so subscribers can implement
   *   rate limiting, alerting, etc.).
   * - Throws `KeyValidationFailedError`.
   *
   * Idempotency: calling `unlockWith(...)` while already unlocked
   * is rejected as an invariant violation. The application layer
   * owns "is the workspace already open in this process?" and
   * should branch before invoking the aggregate.
   */
  public async unlockWith(input: {
    candidate: MasterKey;
    keyId: KeyId;
    validator: KeyValidator;
    occurredAt: Timestamp;
  }): Promise<void> {
    if (this.unlockedKey !== null) {
      throw new InvariantViolationError(
        `encryption config for workspace ${this.workspaceId.toString()} is already unlocked`,
        { invariant: "encryption.unlock.already-unlocked" },
      );
    }
    if (this.findEnvelopeIndex(input.keyId) === -1) {
      throw new InvariantViolationError(
        `key envelope ${input.keyId.toString()} does not exist in workspace ${this.workspaceId.toString()}`,
        { invariant: "encryption.envelopes.exists" },
      );
    }

    const accepted = await input.validator.validate(
      this.keyValidatorBlob,
      input.candidate,
    );

    if (!accepted) {
      this.events.push(
        new KeyValidationFailed({
          workspaceId: this.workspaceId,
          occurredAt: input.occurredAt,
        }),
      );
      throw new KeyValidationFailedError(this.workspaceId);
    }

    this.unlockedKey = input.candidate;
    this.updatedAt = input.occurredAt;
    this.events.push(
      new EncryptionUnlocked({
        workspaceId: this.workspaceId,
        keyId: input.keyId,
        occurredAt: input.occurredAt,
      }),
    );
  }

  /**
   * Drops the in-memory master key and emits `EncryptionLocked`.
   *
   * Mirrors `Workspace.lock`: a no-op call (already locked) is
   * rejected as an invariant violation so the application layer
   * does not silently mask bugs.
   */
  public lock(input: { occurredAt: Timestamp }): void {
    if (this.unlockedKey === null) {
      throw new InvariantViolationError(
        `encryption config for workspace ${this.workspaceId.toString()} is already locked`,
        { invariant: "encryption.lock.already-locked" },
      );
    }
    this.unlockedKey = null;
    this.updatedAt = input.occurredAt;
    this.events.push(
      new EncryptionLocked({
        workspaceId: this.workspaceId,
        occurredAt: input.occurredAt,
      }),
    );
  }

  // -- queries -------------------------------------------------------------

  public getWorkspaceId(): WorkspaceId {
    return this.workspaceId;
  }

  public getKdfSpec(): KdfSpec {
    return this.kdfSpec;
  }

  public getKeyValidatorBlob(): KeyValidatorBlob {
    return this.keyValidatorBlob;
  }

  /**
   * Returns a frozen snapshot of the envelope list. Mutating the
   * returned array does not affect the aggregate (it is a copy);
   * the elements themselves are immutable VOs.
   */
  public getEnvelopes(): readonly KeyEnvelope[] {
    return Object.freeze([...this.envelopes]);
  }

  public getCreatedAt(): Timestamp {
    return this.createdAt;
  }

  public getUpdatedAt(): Timestamp {
    return this.updatedAt;
  }

  public envelopeCount(): number {
    return this.envelopes.length;
  }

  public hasEnvelope(keyId: KeyId): boolean {
    return this.findEnvelopeIndex(keyId) !== -1;
  }

  public isUnlocked(): boolean {
    return this.unlockedKey !== null;
  }

  /**
   * Exposes the in-memory master key via a callback, ONLY if the
   * aggregate is currently unlocked. The callback receives the
   * `MasterKey` VO directly so it can use the standard
   * `withBytes(...)` discipline; the aggregate does not return
   * the bytes itself.
   *
   * Refuses to invoke the callback when locked: a missing key is
   * NOT a "do nothing" condition (callers depend on having a key
   * to decrypt the database), and silently skipping would let
   * bugs through.
   */
  public withUnlockedKey<TResult>(
    callback: (key: MasterKey) => TResult,
  ): TResult {
    if (this.unlockedKey === null) {
      throw new InvariantViolationError(
        `cannot access master key: encryption config for workspace ${this.workspaceId.toString()} is locked`,
        { invariant: "encryption.unlocked-key.requires-unlocked" },
      );
    }
    return callback(this.unlockedKey);
  }

  /**
   * Drains and returns the buffered events. Mirrors the contract
   * of `Workspace.pullEvents`.
   */
  public pullEvents(): readonly DomainEvent[] {
    if (this.events.length === 0) return Object.freeze([]);
    const drained = this.events.slice();
    this.events.length = 0;
    return Object.freeze(drained);
  }

  // -- internals -----------------------------------------------------------

  private findEnvelopeIndex(keyId: KeyId): number {
    for (let i = 0; i < this.envelopes.length; i += 1) {
      const envelope = this.envelopes[i];
      if (envelope?.keyId.equals(keyId) === true) {
        return i;
      }
    }
    return -1;
  }
}
