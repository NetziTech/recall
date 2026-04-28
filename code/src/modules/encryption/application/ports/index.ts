/**
 * Public surface of `modules/encryption/application/ports/`.
 *
 * Re-exports input (driving) ports — what the application layer
 * promises to do for callers — and output (driven) ports — what the
 * application layer requires the world to provide.
 *
 * The split between `in/` and `out/` mirrors the canonical hexagonal
 * naming convention from `docs/12-lineamientos-arquitectura.md` §1.3
 * and keeps the dependency arrows visible at the import path level.
 */

export type { DerivePassphraseKey } from "./in/derive-passphrase-key.port.ts";
export type { DestroyEncryption } from "./in/destroy-encryption.port.ts";
export type { InitializeEncryption } from "./in/initialize-encryption.port.ts";
export type { LockEncryption } from "./in/lock-encryption.port.ts";
export type { UnlockEncryption } from "./in/unlock-encryption.port.ts";

export type { Kdf } from "./out/kdf.port.ts";
export type { RandomBytes } from "./out/random-bytes.port.ts";
export type { ValidatorEncrypter } from "./out/validator-encrypter.port.ts";
