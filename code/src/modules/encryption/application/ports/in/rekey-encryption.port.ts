import type { Timestamp } from "../../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../../shared/domain/value-objects/workspace-id.ts";
import type { KeyId } from "../../../domain/value-objects/key-id.ts";
import type { KeyLabel } from "../../../domain/value-objects/key-label.ts";
import type { Passphrase } from "../../../domain/value-objects/passphrase.ts";

/**
 * Input contract for {@link RekeyEncryption}.
 *
 * - `workspaceId` identifies the encrypted workspace whose envelope
 *   list will be rotated. The aggregate is loaded by this id; the
 *   use case refuses to operate on workspaces whose encryption
 *   config does not exist (`shared` / `private` modes).
 * - `currentPassphrase` is the passphrase that opens ANY currently
 *   active envelope. The use case delegates unlock to
 *   {@link UnlockEncryption} internally so the in-memory aggregate
 *   becomes unlocked BEFORE the rotation begins.
 * - `newPassphrase` is the passphrase the user wants the workspace
 *   to be opened with from now on. It is fed to the KDF (with a
 *   freshly minted salt) to derive the key that AEAD-wraps the
 *   SAME master key the workspace is already unlocked with.
 * - `label` is the optional human-readable identifier shown by
 *   `recall add-key --list` for the freshly minted envelope. The
 *   removed envelopes' labels are NOT preserved (rekey is "fresh
 *   start" — operators register a single new envelope and may
 *   re-add secondary envelopes manually with `recall add-key`).
 */
export interface RekeyInput {
  readonly workspaceId: WorkspaceId;
  readonly currentPassphrase: Passphrase;
  readonly newPassphrase: Passphrase;
  readonly label: KeyLabel | null;
}

/**
 * Output contract for {@link RekeyEncryption}.
 *
 * - `newEnvelopeId` is the freshly minted `KeyId` of the envelope
 *   created from `newPassphrase`. After the use case returns, this
 *   is the ONLY envelope still present on the aggregate.
 * - `removedEnvelopeIds` is the (sorted-by-original-`createdAt`,
 *   ascending) list of envelope ids that existed BEFORE the rotation
 *   and were stripped during the flow. Empty only if the workspace
 *   had been initialised in a corrupt state with zero envelopes
 *   (the aggregate rejects that on rehydrate, so callers should
 *   treat the empty list as a defensive defaults-only path).
 * - `rotatedAt` is the canonical timestamp stored on the new
 *   envelope's `createdAt` and reused as the audit-log rows'
 *   `occurred_at_ms`.
 */
export interface RekeyOutput {
  readonly newEnvelopeId: KeyId;
  readonly removedEnvelopeIds: readonly KeyId[];
  readonly rotatedAt: Timestamp;
}

/**
 * Driving (input) port: rotate the passphrase-envelope list of an
 * encrypted workspace WITHOUT rotating the master key.
 *
 * **Source-of-truth: ADR-005 Q2 (Phase-22, `docs/12-lineamientos-arquitectura.md`
 * §1.5.5 appendix Q2).** The decision: rekey rotates ENVELOPES
 * (master key stays stable) under the pattern
 * `addEnvelope(new) → verify → removeEnvelope(old)` inside a SQLite
 * transaction (`BEGIN IMMEDIATE`). The SQLCipher `PRAGMA rekey` is
 * NOT invoked — the master key is process-local and never persisted
 * outside an envelope, so rotating it would require unwrapping every
 * row of every table, a flow we explicitly defer.
 *
 * **Documented limit (CRITICAL).** "Rekey of envelopes" does NOT
 * mitigate a compromise of the master key. If the master key was
 * leaked (memory dump, swap leak, cache leak) rotating envelopes
 * does NOT evict the attacker — they retain the master key and any
 * future envelope still wraps THE SAME key. Operators whose master
 * key is suspected leaked MUST run a full `recall init` against a
 * fresh workspace and re-import their data, NOT a `recall rekey`.
 *
 * Flow (7 steps):
 * 1. Delegate to {@link UnlockEncryption} so the aggregate becomes
 *    unlocked in memory. Refuse if absent
 *    (`EncryptionNotInitializedError`) or the passphrase does not
 *    match any envelope (`KeyValidationFailedError`).
 * 2. Mint fresh material for the new envelope: a CSPRNG salt and
 *    a `KdfParams` instance with project defaults.
 * 3. Derive a new `DerivedKey` from `newPassphrase` + the fresh
 *    salt via the injected `Kdf` port.
 * 4. AEAD-wrap the currently-unlocked master key with the derived
 *    key via the injected `EnvelopeCipher`, producing the
 *    envelope's `EncryptedMasterKey`.
 * 5. Append the new `KeyEnvelope` to the aggregate via
 *    `EncryptionConfig.addEnvelope({...})`. The aggregate enforces
 *    "all envelopes wrap the SAME master key" (`MasterKeyMismatchError`).
 * 6. Strip every envelope from the aggregate EXCEPT the new one
 *    via `EncryptionConfig.removeEnvelope({...})`. The aggregate
 *    refuses to drop below one envelope (`LastEnvelopeRemovalError`),
 *    which is why the new envelope MUST be added BEFORE the
 *    removals begin.
 * 7. Persist the aggregate via `EncryptionConfigRepository.save`,
 *    then append the audit chain inside a single SQLite
 *    `transaction(...)` (one row per envelope state transition):
 *    `RekeyStarted` → `UnlockSucceeded` → `KeyEnvelopeAdded` →
 *    one `KeyEnvelopeRemoved` per removed envelope → `RekeyCompleted`.
 *
 * Atomicity (ADR-005 Q2 + Q4 limits):
 * - The SQLite audit-log chain is committed in ONE transaction so
 *   either every row is visible or none is. The transaction
 *   primitive is synchronous (`DatabaseConnection.transaction<T>(fn: () => T): T`);
 *   the underlying audit-log adapter is synchronous-under-async
 *   (better-sqlite3).
 * - The encryption config is persisted to a JSON file
 *   (`config.json`) BEFORE the audit chain. The same residual
 *   atomicity gap as A5 applies: a crash between
 *   `repository.save(config)` and the audit batch leaves the new
 *   envelope visible on disk but the audit trail empty. The
 *   ADR-005 Q4 trade-off accepts this branch (the operator can
 *   detect the gap via `recall audit`; losing the envelope
 *   irrecoverably would be worse).
 *
 * Failure modes (THROWN — no Result channel):
 * - `EncryptionNotInitializedError` — workspace has no encryption
 *   config (mode `shared` / `private`).
 * - `KeyValidationFailedError` — `currentPassphrase` did not match
 *   any envelope.
 * - `EncryptionLockedError` — defensive; should never trigger
 *   because step 1 unlocks the aggregate.
 * - `MasterKeyMismatchError` — defensive, raised by the aggregate
 *   if the wrap recovers a key that does not match the
 *   currently-unlocked one. Effectively unreachable when the use
 *   case wraps the SAME `MasterKey` reference the aggregate holds.
 * - `LastEnvelopeRemovalError` — defensive; raised if the new
 *   envelope was NOT appended (step 5 silently failed) before
 *   the removals begin. The use case re-throws after emitting a
 *   `RekeyFailed` audit row.
 * - `InfrastructureError` subclasses (`KdfDerivationFailedError`,
 *   `AeadFailedError`, `RandomBytesError`, ...) — propagated
 *   unchanged. The use case appends a `RekeyFailed` audit row
 *   before re-throwing.
 */
export interface RekeyEncryption {
  rekey(input: RekeyInput): Promise<RekeyOutput>;
}
