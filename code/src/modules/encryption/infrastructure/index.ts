/**
 * Public surface of `modules/encryption/infrastructure/`.
 *
 * Re-exports the concrete adapters so the composition root can wire
 * them with their ports in one place.
 *
 * Persistence:
 * - `JsonEncryptionConfigRepository` is the canonical adapter for
 *   `EncryptionConfigRepository`. It writes the encryption slice
 *   (`kdf`, `kdf_params`, `key_validator_blob_b64`, `key_envelopes`,
 *   plus a few internal markers) directly to
 *   `<workspaceRoot>/.mcp-memoria/config.json`, side-by-side with
 *   the workspace module's own slice (workspace identity, embedder
 *   spec, etc.). The two modules share the file but own disjoint
 *   top-level slices and the adapter merges them safely.
 *
 * The barrel file mirrors the pattern adopted by
 * `shared/infrastructure/index.ts`.
 */

export { Argon2idKdf } from "./kdf/argon2id-kdf.ts";

export { AesGcmEnvelopeCipher } from "./cipher/aes-gcm-envelope-cipher.ts";
export { AesGcmKeyValidator } from "./cipher/aes-gcm-key-validator.ts";
export { AesGcmValidatorEncrypter } from "./cipher/aes-gcm-validator-encrypter.ts";

export { WebCryptoRandomBytes } from "./random/web-crypto-random-bytes.ts";

export { EncryptionKeyAdapter } from "./database/encryption-key-adapter.ts";

export { JsonEncryptionConfigRepository } from "./persistence/json-encryption-config-repository.ts";

export { EncryptionInfrastructureError } from "./errors/encryption-infrastructure-error.ts";
export { KdfDerivationFailedError } from "./errors/kdf-derivation-failed-error.ts";
export type { KdfDerivationFailedKind } from "./errors/kdf-derivation-failed-error.ts";
export { AeadFailedError } from "./errors/aead-failed-error.ts";
export type { AeadFailedKind } from "./errors/aead-failed-error.ts";
export { RandomBytesError } from "./errors/random-bytes-error.ts";
export { EncryptionConfigPersistenceError } from "./errors/encryption-config-persistence-error.ts";
export type { EncryptionConfigPersistenceKind } from "./errors/encryption-config-persistence-error.ts";
