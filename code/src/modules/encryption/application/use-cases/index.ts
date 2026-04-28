/**
 * Public surface of `modules/encryption/application/use-cases/`.
 *
 * Re-exports the concrete use case classes so the composition root
 * can wire them with their adapters in one place.
 */

export { DerivePassphraseKeyUseCase } from "./derive-passphrase-key.use-case.ts";
export { DestroyEncryptionUseCase } from "./destroy-encryption.use-case.ts";
export { InitializeEncryptionUseCase } from "./initialize-encryption.use-case.ts";
export { LockEncryptionUseCase } from "./lock-encryption.use-case.ts";
export { UnlockEncryptionUseCase } from "./unlock-encryption.use-case.ts";
