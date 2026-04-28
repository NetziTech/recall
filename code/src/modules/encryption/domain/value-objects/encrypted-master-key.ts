import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";

/**
 * AEAD tag length, in bytes, expected by the project's envelope
 * cipher.
 *
 * Both AES-GCM and ChaCha20-Poly1305 — the two AEAD primitives the
 * encryption module is allowed to use under
 * `docs/06-stack-tecnico.md` §4-§5 — produce 16-byte (128-bit) tags
 * by default. Pinning the length in the domain prevents an adapter
 * from quietly truncating the tag (which would weaken authenticity)
 * and gives the unwrap path a clear failure point if the persisted
 * envelope was tampered with.
 */
const AEAD_TAG_LENGTH_BYTES = 16;

/**
 * Minimum IV/nonce length required by the AEAD primitives the
 * project supports. AES-GCM mandates 12 bytes (96 bits) per NIST
 * SP 800-38D; ChaCha20-Poly1305 uses 12 bytes per RFC 8439.
 */
const MIN_IV_LENGTH_BYTES = 12;

/**
 * Value object representing the master key after AEAD encryption
 * with a `DerivedKey`.
 *
 * This is the cryptographic blob that gets persisted in the
 * `key_envelopes` array of `.mcp-memoria/config.json` (see
 * `docs/03-modelo-datos.md` §2 and `docs/11-seguridad-modos.md` §7
 * "Multi-key (v0.5+)"). On unlock, the `EnvelopeCipher.unwrap`
 * adapter takes this VO + a `DerivedKey` and returns the plain
 * `MasterKey` — only if the AEAD tag verifies, which is what stops
 * an attacker from substituting another envelope.
 *
 * Invariants:
 * - `ciphertext.length === MasterKey.lengthBytes()` because AEAD
 *   produces ciphertext of the same length as the plaintext (the
 *   tag is carried separately in this representation).
 * - `iv.length >= MIN_IV_LENGTH_BYTES`. The exact length depends on
 *   the AEAD primitive but the floor is the same.
 * - `tag.length === AEAD_TAG_LENGTH_BYTES` (128 bits).
 * - All buffers are defensively copied at construction; instances
 *   are immutable.
 *
 * Equality:
 * - Two `EncryptedMasterKey` instances are equal iff their three
 *   buffers match byte-for-byte. Comparison is content-based; a
 *   constant-time pass keeps the API symmetric with the secret VOs.
 *
 * Note on dependencies:
 * - The VO does NOT know which AEAD primitive produced it. The
 *   adapter that wraps/unwraps owns the choice (declared in
 *   `infrastructure/crypto/`). This separation keeps the domain
 *   pluggable.
 */
export class EncryptedMasterKey {
  private readonly cipher: Uint8Array;
  private readonly nonce: Uint8Array;
  private readonly authTag: Uint8Array;

  private constructor(
    cipher: Uint8Array,
    nonce: Uint8Array,
    authTag: Uint8Array,
  ) {
    this.cipher = new Uint8Array(cipher);
    this.nonce = new Uint8Array(nonce);
    this.authTag = new Uint8Array(authTag);
  }

  /**
   * Builds an `EncryptedMasterKey` from already-validated buffers.
   * Used by `EnvelopeCipher.wrap(...)` (after producing the AEAD
   * output) and by the persistence adapter (after base64-decoding
   * the values from `config.json`).
   */
  public static create(input: {
    ciphertext: Uint8Array;
    iv: Uint8Array;
    tag: Uint8Array;
  }): EncryptedMasterKey {
    EncryptedMasterKey.assertBuffer(input.ciphertext, "envelope.ciphertext");
    EncryptedMasterKey.assertBuffer(input.iv, "envelope.iv");
    EncryptedMasterKey.assertBuffer(input.tag, "envelope.tag");

    if (input.iv.length < MIN_IV_LENGTH_BYTES) {
      throw new InvalidInputError(
        `envelope iv must be at least ${String(MIN_IV_LENGTH_BYTES)} bytes (got: ${String(input.iv.length)})`,
        { field: "envelope.iv" },
      );
    }
    if (input.tag.length !== AEAD_TAG_LENGTH_BYTES) {
      throw new InvalidInputError(
        `envelope tag must be exactly ${String(AEAD_TAG_LENGTH_BYTES)} bytes (got: ${String(input.tag.length)})`,
        { field: "envelope.tag" },
      );
    }
    if (input.ciphertext.length === 0) {
      throw new InvalidInputError("envelope ciphertext must not be empty", {
        field: "envelope.ciphertext",
      });
    }

    return new EncryptedMasterKey(input.ciphertext, input.iv, input.tag);
  }

  /**
   * Exposes the ciphertext bytes via a callback. The buffer passed
   * to the callback is a fresh defensive copy. Mirrors
   * `SaltBytes.withBytes`.
   *
   * The ciphertext is NOT secret in the cryptographic sense (it is
   * persisted publicly in `config.json`) but the same callback
   * pattern is used for API symmetry across all crypto VOs.
   */
  public withCiphertext<TResult>(
    callback: (bytes: Uint8Array) => TResult,
  ): TResult {
    return callback(new Uint8Array(this.cipher));
  }

  /** See `withCiphertext`. */
  public withIv<TResult>(callback: (bytes: Uint8Array) => TResult): TResult {
    return callback(new Uint8Array(this.nonce));
  }

  /** See `withCiphertext`. */
  public withTag<TResult>(callback: (bytes: Uint8Array) => TResult): TResult {
    return callback(new Uint8Array(this.authTag));
  }

  public ciphertextLength(): number {
    return this.cipher.length;
  }

  public ivLength(): number {
    return this.nonce.length;
  }

  public tagLength(): number {
    return this.authTag.length;
  }

  /**
   * Constant-time equality across the three buffers concatenated.
   * Iterating to completion regardless of mismatches keeps the API
   * timing-safe.
   */
  public equals(other: EncryptedMasterKey): boolean {
    if (this === other) return true;
    if (
      this.cipher.length !== other.cipher.length ||
      this.nonce.length !== other.nonce.length ||
      this.authTag.length !== other.authTag.length
    ) {
      return false;
    }
    let diff = 0;
    for (let i = 0; i < this.cipher.length; i += 1) {
      diff |= (this.cipher[i] ?? 0) ^ (other.cipher[i] ?? 0);
    }
    for (let i = 0; i < this.nonce.length; i += 1) {
      diff |= (this.nonce[i] ?? 0) ^ (other.nonce[i] ?? 0);
    }
    for (let i = 0; i < this.authTag.length; i += 1) {
      diff |= (this.authTag[i] ?? 0) ^ (other.authTag[i] ?? 0);
    }
    return diff === 0;
  }

  /** Exposes the AEAD tag length for documentation/tests. */
  public static tagLengthBytes(): number {
    return AEAD_TAG_LENGTH_BYTES;
  }

  /** Exposes the minimum IV length for documentation/tests. */
  public static minIvLengthBytes(): number {
    return MIN_IV_LENGTH_BYTES;
  }

  // -- internals ------------------------------------------------------------

  private static assertBuffer(value: Uint8Array, field: string): void {
    if (!(value instanceof Uint8Array)) {
      throw new InvalidInputError(`${field} must be a Uint8Array`, {
        field,
      });
    }
  }
}
