import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";

/**
 * Required length, in bytes, of a key derived from a passphrase.
 *
 * The KDF in the encrypted-mode contract (`docs/11-seguridad-modos.md`
 * §3 / §7) emits a 32-byte key that is then used as the AES-256
 * symmetric key for the AEAD cipher that wraps the master key. The
 * length matches `MasterKey` because the wrapped key is itself 32
 * bytes; the AEAD must therefore use a key of equivalent (or
 * stronger) strength.
 */
const DERIVED_KEY_LENGTH_BYTES = 32;

/**
 * Sentinel string returned by every accessor that could otherwise
 * reveal the key material. Mirrors the redaction strategy of
 * `MasterKey`; see that file for the rationale.
 */
const REDACTED_REPRESENTATION = "<DerivedKey:redacted>";

/**
 * Value object encapsulating the key derived from a user passphrase
 * via the workspace's KDF spec (see `KdfParams`).
 *
 * The derived key never gets persisted: it is computed on demand
 * during unlock, used to AEAD-decrypt the appropriate
 * `KeyEnvelope.encryptedMasterKey`, and then discarded. The actual
 * cryptographic material that lives on disk is the wrapped master
 * key, not this derived key.
 *
 * Security invariants (NON-NEGOTIABLE):
 * - The wrapped buffer is exactly `DERIVED_KEY_LENGTH_BYTES` long.
 * - The buffer is NEVER exposed via a getter. The only way to obtain
 *   the bytes is `withBytes(callback)`, which receives a defensive
 *   copy in a controlled scope.
 * - `toString()` returns the redacted sentinel.
 * - `toJSON()` returns the redacted sentinel.
 * - Equality is constant-time.
 *
 * Lifecycle:
 * - Built by `KeyDerivation.derive(passphrase, params)` (the
 *   infrastructure adapter that wraps argon2id).
 * - Consumed by `EnvelopeCipher.wrap(masterKey, derivedKey)` /
 *   `EnvelopeCipher.unwrap(encryptedMasterKey, derivedKey)`.
 * - Discarded as soon as the unwrap completes.
 */
export class DerivedKey {
  /**
   * Internal buffer. Marked `private readonly` and accessed only via
   * `withBytes`, which clones it before exposing to the callback.
   * Never assign this field externally; never expose via getter.
   */
  private readonly bytes: Uint8Array;

  private constructor(bytes: Uint8Array) {
    this.bytes = new Uint8Array(bytes);
  }

  /**
   * Builds a `DerivedKey` from a raw 32-byte buffer. Used by the
   * KDF adapter after `argon2id` finishes.
   */
  public static from(raw: Uint8Array): DerivedKey {
    if (!(raw instanceof Uint8Array)) {
      throw new InvalidInputError("derived key must be a Uint8Array", {
        field: "derived_key",
      });
    }
    if (raw.length !== DERIVED_KEY_LENGTH_BYTES) {
      throw new InvalidInputError(
        `derived key must be exactly ${String(DERIVED_KEY_LENGTH_BYTES)} bytes (got: ${String(raw.length)})`,
        { field: "derived_key" },
      );
    }
    return new DerivedKey(raw);
  }

  public length(): number {
    return this.bytes.length;
  }

  /**
   * The ONLY supported way to access the wrapped bytes. See
   * `MasterKey.withBytes` for the rationale.
   */
  public withBytes<TResult>(callback: (bytes: Uint8Array) => TResult): TResult {
    const copy = new Uint8Array(this.bytes);
    return callback(copy);
  }

  /** Constant-time equality; see `MasterKey.equals`. */
  public equals(other: DerivedKey): boolean {
    if (this === other) return true;
    if (this.bytes.length !== other.bytes.length) return false;
    let diff = 0;
    for (let i = 0; i < this.bytes.length; i += 1) {
      const a = this.bytes[i] ?? 0;
      const b = other.bytes[i] ?? 0;
      diff |= a ^ b;
    }
    return diff === 0;
  }

  public toString(): string {
    return REDACTED_REPRESENTATION;
  }

  public toJSON(): string {
    return REDACTED_REPRESENTATION;
  }

  public static lengthBytes(): number {
    return DERIVED_KEY_LENGTH_BYTES;
  }

  public static redactedRepresentation(): string {
    return REDACTED_REPRESENTATION;
  }
}
