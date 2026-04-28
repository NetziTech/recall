import type { Result } from "../../../../../shared/domain/types/result.ts";
import type { WorkspaceId } from "../../../../../shared/domain/value-objects/workspace-id.ts";
import type { EncryptionNotInitializedError } from "../../../domain/errors/encryption-not-initialized-error.ts";
import type { KeyValidationFailedError } from "../../../domain/errors/key-validation-failed-error.ts";
import type { Passphrase } from "../../../domain/value-objects/passphrase.ts";

/**
 * Driving (input) port: destroy the encryption slice of an
 * encrypted workspace.
 *
 * SCOPE — VERY IMPORTANT:
 * - This port owns ONLY the cryptographic half of the
 *   `encrypted -> private` mode transition documented in
 *   `docs/11-seguridad-modos.md` §5: it removes the persisted
 *   encryption fields (`kdf`, `kdf_params`,
 *   `key_validator_blob_b64`, `key_envelopes`) from
 *   `config.json` so the workspace can no longer be unlocked
 *   through the encryption module.
 * - It DOES NOT touch the SQLCipher database files. Re-keying /
 *   decrypting the actual `recall.db` and `vectors.db` into
 *   plain SQLite files is the responsibility of the workspace
 *   module's mode-change flow. The composition root orchestrates
 *   both halves in the right order (decrypt the data FIRST, then
 *   call this port to drop the metadata, then mark the workspace
 *   as `private`).
 *
 * Authority:
 * - The use case validates authority by re-deriving a key from
 *   the supplied `passphrase` and matching it against an existing
 *   `KeyEnvelope` (same flow as `UnlockEncryption`). The
 *   passphrase is the canonical proof-of-ownership at the
 *   encryption boundary; relying on the runtime "is the
 *   workspace already unlocked?" flag would let any process
 *   that obtained a stale unlock state destroy the
 *   configuration without re-authentication.
 *
 * Recoverable failure modes (Result channel):
 * - `EncryptionNotInitializedError`: the workspace has no
 *   encryption slice. The caller can safely treat this as
 *   already-destroyed (idempotent at the use case level even
 *   though the repository's `delete` is independently
 *   idempotent at its own boundary).
 * - `KeyValidationFailedError`: the passphrase does not match
 *   any envelope. Same wire mapping as `UnlockEncryption`
 *   (`-32108 INVALID_KEY`).
 *
 * Unrecoverable failure modes (THROWN as `InfrastructureError`):
 * - `KdfDerivationFailedError`, `AeadFailedError` (kind !=
 *   `authentication-failed`), `EncryptionConfigPersistenceError`.
 *   The composition root logs and aborts.
 */
export interface DestroyEncryption {
  destroy(input: {
    readonly workspaceId: WorkspaceId;
    readonly passphrase: Passphrase;
  }): Promise<
    Result<
      void,
      EncryptionNotInitializedError | KeyValidationFailedError
    >
  >;
}
