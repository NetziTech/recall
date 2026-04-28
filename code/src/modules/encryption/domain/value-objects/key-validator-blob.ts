import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";

/**
 * Length, in bytes, of the AEAD tag attached to the validator blob.
 * Mirrors `EncryptedMasterKey.tagLengthBytes()`; both values use the
 * same AEAD primitive family and we keep the constant explicit here
 * so the file is self-contained for readers.
 */
const AEAD_TAG_LENGTH_BYTES = 16;

/**
 * Minimum IV length, in bytes. See `EncryptedMasterKey.minIvLengthBytes`
 * for the rationale.
 */
const MIN_IV_LENGTH_BYTES = 12;

/**
 * Minimum length, in bytes, of the expected plaintext sentinel. The
 * canonical example shipped in `docs/11-seguridad-modos.md` §7
 * ("Validacion de clave") uses the literal string `"VALID"`
 * (5 bytes). The domain accepts any non-empty buffer so the
 * infrastructure adapter can pick a longer sentinel for higher
 * confidence (e.g. a random-but-stable workspace fingerprint), but
 * insists the buffer is non-empty so the comparison is meaningful.
 */
const MIN_PLAINTEXT_LENGTH_BYTES = 1;

/**
 * Value object representing the "key validator blob" used to verify
 * that a candidate `MasterKey` decrypts the workspace correctly,
 * without having to open the actual SQLCipher database.
 *
 * Mirrors `key_validator_blob_b64` documented in
 * `docs/03-modelo-datos.md` §2 and `docs/11-seguridad-modos.md` §7
 * ("Validacion de clave"). The flow is:
 *
 * 1. At init time, the infrastructure layer encrypts a known
 *    sentinel (e.g. `"VALID"`) with the freshly generated
 *    `MasterKey` and stores the (ciphertext, iv, tag) tuple in
 *    `config.json`.
 * 2. On unlock, the candidate `MasterKey` is used to AEAD-decrypt
 *    the same blob. If the decrypted plaintext matches the expected
 *    sentinel byte-for-byte AND the AEAD tag verifies, the key is
 *    correct.
 * 3. If either check fails, `KeyValidationFailedError` is raised
 *    (mapped to `-32108 INVALID_KEY` on the wire).
 *
 * Why this design (vs trying to open the DB directly):
 * - Faster: the validator blob is a few bytes, validation runs in
 *   < 100ms (`docs/11-seguridad-modos.md` §7) vs the full DB open
 *   that has to materialize SQLite pages.
 * - Doesn't lock the DB while the user types a wrong passphrase
 *   (which is important when multiple processes compete for the
 *   workspace).
 * - Gives the system a stable "is this key valid?" oracle
 *   independent of the schema version of the underlying DB.
 *
 * Invariants:
 * - `expectedPlaintext.length >= MIN_PLAINTEXT_LENGTH_BYTES`.
 * - `iv.length >= MIN_IV_LENGTH_BYTES`.
 * - `tag.length === AEAD_TAG_LENGTH_BYTES` (128 bits).
 * - `ciphertext.length === expectedPlaintext.length` (AEAD output
 *   matches the input length; the tag is carried separately).
 * - All buffers are defensively copied at construction.
 *
 * Note: the actual decryption that produces the plaintext fed to
 * `matches(...)` lives in the `KeyValidator` adapter (the domain
 * service interface in `services/key-validator.ts`); this VO only
 * owns the comparison.
 */
export class KeyValidatorBlob {
  private readonly plaintext: Uint8Array;
  private readonly cipher: Uint8Array;
  private readonly nonce: Uint8Array;
  private readonly authTag: Uint8Array;

  private constructor(
    plaintext: Uint8Array,
    cipher: Uint8Array,
    nonce: Uint8Array,
    authTag: Uint8Array,
  ) {
    this.plaintext = new Uint8Array(plaintext);
    this.cipher = new Uint8Array(cipher);
    this.nonce = new Uint8Array(nonce);
    this.authTag = new Uint8Array(authTag);
  }

  /**
   * Builds a `KeyValidatorBlob` from already-encrypted material.
   * Used both at init time (after the infrastructure layer
   * AEAD-encrypts the sentinel) and at unlock time (after the
   * persistence layer base64-decodes the values from
   * `config.json`).
   */
  public static create(input: {
    expectedPlaintext: Uint8Array;
    ciphertext: Uint8Array;
    iv: Uint8Array;
    tag: Uint8Array;
  }): KeyValidatorBlob {
    KeyValidatorBlob.assertBuffer(
      input.expectedPlaintext,
      "validator.expected_plaintext",
    );
    KeyValidatorBlob.assertBuffer(input.ciphertext, "validator.ciphertext");
    KeyValidatorBlob.assertBuffer(input.iv, "validator.iv");
    KeyValidatorBlob.assertBuffer(input.tag, "validator.tag");

    if (input.expectedPlaintext.length < MIN_PLAINTEXT_LENGTH_BYTES) {
      throw new InvalidInputError(
        `validator expected_plaintext must be at least ${String(MIN_PLAINTEXT_LENGTH_BYTES)} byte (got: ${String(input.expectedPlaintext.length)})`,
        { field: "validator.expected_plaintext" },
      );
    }
    if (input.ciphertext.length !== input.expectedPlaintext.length) {
      throw new InvalidInputError(
        `validator ciphertext length (${String(input.ciphertext.length)}) must equal expected_plaintext length (${String(input.expectedPlaintext.length)})`,
        { field: "validator.ciphertext" },
      );
    }
    if (input.iv.length < MIN_IV_LENGTH_BYTES) {
      throw new InvalidInputError(
        `validator iv must be at least ${String(MIN_IV_LENGTH_BYTES)} bytes (got: ${String(input.iv.length)})`,
        { field: "validator.iv" },
      );
    }
    if (input.tag.length !== AEAD_TAG_LENGTH_BYTES) {
      throw new InvalidInputError(
        `validator tag must be exactly ${String(AEAD_TAG_LENGTH_BYTES)} bytes (got: ${String(input.tag.length)})`,
        { field: "validator.tag" },
      );
    }

    return new KeyValidatorBlob(
      input.expectedPlaintext,
      input.ciphertext,
      input.iv,
      input.tag,
    );
  }

  /**
   * Constant-time comparison between the supplied (already-decrypted)
   * plaintext and the expected sentinel. Returns `true` iff they
   * match byte-for-byte.
   *
   * Constant-time matters here: if the comparison short-circuited on
   * the first mismatch, an attacker submitting candidate keys could
   * measure response time to learn how many leading bytes of the
   * sentinel they got right — though the AEAD tag check upstream
   * already prevents most of that, defense-in-depth is cheap.
   *
   * Length mismatches return `false` immediately because the length
   * itself is not secret.
   */
  public matches(decrypted: Uint8Array): boolean {
    if (!(decrypted instanceof Uint8Array)) return false;
    if (decrypted.length !== this.plaintext.length) return false;
    let diff = 0;
    for (let i = 0; i < this.plaintext.length; i += 1) {
      diff |= (this.plaintext[i] ?? 0) ^ (decrypted[i] ?? 0);
    }
    return diff === 0;
  }

  /**
   * Exposes the ciphertext bytes via a callback. The buffer passed
   * to the callback is a fresh defensive copy.
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

  /**
   * Exposes the expected plaintext sentinel via a callback. NOT
   * secret in the cryptographic sense (it is a known constant per
   * workspace) but the callback pattern stays consistent with the
   * other crypto VOs.
   */
  public withExpectedPlaintext<TResult>(
    callback: (bytes: Uint8Array) => TResult,
  ): TResult {
    return callback(new Uint8Array(this.plaintext));
  }

  public expectedPlaintextLength(): number {
    return this.plaintext.length;
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
   * Constant-time equality across the four buffers. Two validator
   * blobs are equal iff they would accept the same key with the
   * same sentinel.
   */
  public equals(other: KeyValidatorBlob): boolean {
    if (this === other) return true;
    if (
      this.plaintext.length !== other.plaintext.length ||
      this.cipher.length !== other.cipher.length ||
      this.nonce.length !== other.nonce.length ||
      this.authTag.length !== other.authTag.length
    ) {
      return false;
    }
    let diff = 0;
    for (let i = 0; i < this.plaintext.length; i += 1) {
      diff |= (this.plaintext[i] ?? 0) ^ (other.plaintext[i] ?? 0);
    }
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

  // -- internals ------------------------------------------------------------

  private static assertBuffer(value: Uint8Array, field: string): void {
    if (!(value instanceof Uint8Array)) {
      throw new InvalidInputError(`${field} must be a Uint8Array`, {
        field,
      });
    }
  }
}
