import type { DerivedKey } from "../value-objects/derived-key.ts";
import type { EncryptedMasterKey } from "../value-objects/encrypted-master-key.ts";
import type { MasterKey } from "../value-objects/master-key.ts";

/**
 * Driven port (output port) responsible for AEAD-wrapping and
 * AEAD-unwrapping a `MasterKey` with a `DerivedKey`.
 *
 * The reference adapter uses an authenticated cipher (AES-256-GCM
 * or ChaCha20-Poly1305 — choice documented in
 * `docs/06-stack-tecnico.md` §4-§5). Living the implementation in
 * `infrastructure/crypto/` keeps the domain pluggable while the
 * domain still owns the contract.
 *
 * Two cooperating operations:
 * - `wrap` is invoked at init time and at envelope-add time: the
 *   freshly generated (or already known) `MasterKey` is sealed
 *   with the user's `DerivedKey` and the resulting
 *   `EncryptedMasterKey` is stored in a `KeyEnvelope`.
 * - `unwrap` is invoked at unlock time: an existing
 *   `EncryptedMasterKey` is decrypted with the supplied
 *   `DerivedKey` to recover the `MasterKey`.
 *
 * Contract:
 * - `wrap(masterKey, derivedKey)` MUST return an
 *   `EncryptedMasterKey` whose AEAD tag verifies under
 *   `derivedKey` and whose ciphertext, when decrypted, yields a
 *   buffer equal to `masterKey`'s bytes. The IV MUST be unique per
 *   call (the adapter is responsible for using a CSPRNG).
 * - `unwrap(encrypted, derivedKey)` MUST return the original
 *   `MasterKey` iff (a) `derivedKey` is the same key that was used
 *   to wrap and (b) the ciphertext / IV / tag have not been
 *   tampered with. If either condition fails, the adapter MUST
 *   throw an `Error` (not return `null`): the contract treats a
 *   failed unwrap as an unrecoverable, exceptional condition that
 *   the application layer must explicitly catch (typically to
 *   raise `KeyValidationFailedError` upstream).
 * - Both operations MUST treat their inputs as secret material:
 *   no logging, no telemetry, no caching that survives the call.
 * - Both operations MUST run in constant time with respect to the
 *   secret inputs. The underlying primitives satisfy this
 *   naturally; the contract names it explicitly so reviewers
 *   reject any wrapper that, e.g., short-circuits on length checks
 *   revealing input sizes via timing.
 *
 * Note on dependencies:
 * - The `EncryptedMasterKey` value object lives in the domain
 *   precisely because it is the persistence shape of the wrap
 *   output: keeping the type domain-side lets the repository
 *   serialize it without leaking through application or
 *   infrastructure interfaces.
 */
export interface EnvelopeCipher {
  /**
   * AEAD-encrypts `masterKey` with `derivedKey` and returns the
   * sealed envelope.
   */
  wrap(
    masterKey: MasterKey,
    derivedKey: DerivedKey,
  ): Promise<EncryptedMasterKey>;

  /**
   * AEAD-decrypts `encrypted` with `derivedKey` and returns the
   * original master key. Throws on AEAD authentication failure.
   */
  unwrap(
    encrypted: EncryptedMasterKey,
    derivedKey: DerivedKey,
  ): Promise<MasterKey>;
}
