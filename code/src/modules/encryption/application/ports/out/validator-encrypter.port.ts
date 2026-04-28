import type { KeyValidatorBlob } from "../../../domain/value-objects/key-validator-blob.ts";
import type { MasterKey } from "../../../domain/value-objects/master-key.ts";

/**
 * Driven (output) port that AEAD-encrypts the workspace's validator
 * sentinel under the master key, producing the persisted
 * `KeyValidatorBlob`.
 *
 * Companion to the domain `KeyValidator` port (which performs the
 * verify-side of the same operation). Why two ports instead of one
 * round-trip cipher:
 * - `KeyValidator.validate(blob, candidate)` is a pure ORACLE: "does
 *   this candidate master key decrypt this blob to the expected
 *   sentinel?". Its answer is a `boolean`. It belongs in domain
 *   because the unlock aggregate consumes it directly.
 * - `ValidatorEncrypter.encrypt(masterKey, plaintext)` is the
 *   ENCODER: "produce a fresh blob over this plaintext under this
 *   key". Used only at init/rekey time, never on the unlock hot
 *   path. Living in application keeps the domain free of the
 *   "produce encrypted material" concern (which is purely a side
 *   effect, not a domain invariant).
 *
 * Why not fold this into `EnvelopeCipher`:
 * - `EnvelopeCipher.wrap(masterKey, derivedKey)` is shape-pinned: it
 *   wraps a 32-byte master key with a 32-byte derived key and
 *   returns an `EncryptedMasterKey` of the matching length. The
 *   validator path encrypts an arbitrary-length sentinel, which
 *   does not satisfy that shape contract. Reusing `EnvelopeCipher`
 *   for both would force one of:
 *   a. Padding the sentinel to 32 bytes (works but couples the two
 *      flows).
 *   b. Extending `EnvelopeCipher` with a generic `encryptBytes`
 *      method (broadens the contract beyond what its name promises).
 *   c. A new dedicated port (this one).
 *   Option (c) is the cleanest under SOLID-ISP.
 *
 * Contract:
 * - `encrypt(masterKey, plaintext)` MUST return a `KeyValidatorBlob`
 *   whose AEAD tag verifies under `masterKey` and whose ciphertext,
 *   when decrypted, yields exactly `plaintext` byte for byte.
 * - The IV MUST be unique per call (the adapter is responsible for
 *   using a CSPRNG). The infrastructure adapter does not delegate
 *   this to `RandomBytes` so the call site stays self-contained.
 * - The implementation MUST treat both inputs as secret material:
 *   no logging, no telemetry, no caching that survives the call.
 * - The implementation MUST run in constant time with respect to
 *   the master key bytes. The underlying primitives satisfy this
 *   naturally; the contract names it explicitly.
 *
 * Reference adapter:
 * - `AesGcmValidatorEncrypter`
 *   (`modules/encryption/infrastructure/cipher/aes-gcm-validator-encrypter.ts`)
 *   delegates to Node's Web Crypto AES-GCM (the same primitive
 *   `AesGcmEnvelopeCipher` uses) so both ports share validated code.
 */
export interface ValidatorEncrypter {
  encrypt(input: {
    masterKey: MasterKey;
    plaintext: Uint8Array;
  }): Promise<KeyValidatorBlob>;
}
