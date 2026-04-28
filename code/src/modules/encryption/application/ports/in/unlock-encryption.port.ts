import type { Result } from "../../../../../shared/domain/types/result.ts";
import type { WorkspaceId } from "../../../../../shared/domain/value-objects/workspace-id.ts";
import type { EncryptionConfig } from "../../../domain/aggregates/encryption-config.ts";
import type { EncryptionNotInitializedError } from "../../../domain/errors/encryption-not-initialized-error.ts";
import type { KeyValidationFailedError } from "../../../domain/errors/key-validation-failed-error.ts";
import type { Passphrase } from "../../../domain/value-objects/passphrase.ts";

/**
 * Driving (input) port: unlock an encrypted workspace given a
 * passphrase.
 *
 * Orchestrates the cryptographic dance documented in
 * `docs/11-seguridad-modos.md` §3 / §7:
 * 1. Loads the `EncryptionConfig` aggregate by `WorkspaceId`.
 * 2. Derives the `DerivedKey` from the supplied passphrase using the
 *    persisted `KdfParams`.
 * 3. Iterates the persisted `KeyEnvelope`s, attempting to AEAD-unwrap
 *    each one with the derived key, until one yields a candidate
 *    `MasterKey`.
 * 4. Verifies the candidate against the persisted `KeyValidatorBlob`
 *    and stores it on the aggregate via
 *    `EncryptionConfig.unlockWith(...)`.
 * 5. Persists the aggregate so subsequent calls observe the unlocked
 *    state (the `unlockedKey` field itself is NOT persisted; only the
 *    `updatedAt` timestamp and any incidental state changes are).
 * 6. Returns the unlocked aggregate so the caller can hand its master
 *    key to the SQLCipher adapter.
 *
 * Recoverable failure modes (Result channel):
 * - `EncryptionNotInitializedError`: the workspace exists but is not
 *   in encrypted mode. Caller should branch into the shared/private
 *   handler.
 * - `KeyValidationFailedError`: the passphrase does not match any
 *   envelope, OR no envelope unwrapped successfully under the
 *   derived key. Mapped to wire-level `-32108 INVALID_KEY`.
 *
 * Unrecoverable failure modes (THROWN as `InfrastructureError`):
 * - `KdfDerivationFailedError`: the KDF primitive failed (OOM,
 *   missing native binding). Composition root logs + aborts.
 * - `AeadFailedError` with kind != `authentication-failed`: the AEAD
 *   primitive itself misbehaved (subtle missing, unexpected library
 *   error). Composition root logs + aborts.
 *
 * Note that an AEAD `authentication-failed` is NOT thrown as an
 * exception: it is the normal "wrong key" outcome and gets folded
 * into `KeyValidationFailedError` by the use case.
 */
export interface UnlockEncryption {
  unlock(input: {
    workspaceId: WorkspaceId;
    passphrase: Passphrase;
  }): Promise<
    Result<
      EncryptionConfig,
      EncryptionNotInitializedError | KeyValidationFailedError
    >
  >;
}
