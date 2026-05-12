import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";

/**
 * Minimum number of bytes required for an argon2id salt.
 *
 * Argon2's RFC 9106 §3.1 establishes 16 bytes (128 bits) as the
 * minimum recommended salt length for password hashing. The encrypted
 * mode contract in `docs/11-seguridad-modos.md` §3 (`kdf_params.salt`)
 * does not pin a minimum but the project standard is to follow the
 * spec floor; anything weaker is rejected by the domain so a
 * misconfigured `config.json` cannot silently downgrade the security
 * posture.
 */
const MIN_SALT_LENGTH_BYTES = 16;

/**
 * Value object encapsulating the salt portion of a KDF spec.
 *
 * Mirrors `kdf_params.salt` (and `salt_b64` on the wire) documented in
 * `docs/03-modelo-datos.md` §2 ("Campos especificos del modo
 * encrypted") and `docs/11-seguridad-modos.md` §3 / §7. The value is
 * deliberately modelled as a value object (not a raw `Uint8Array`)
 * because:
 *
 * - It needs to enforce a minimum length invariant.
 * - It needs immutability semantics: the bytes are copied in and the
 *   internal buffer is never exposed by reference (see `withBytes`).
 *
 * Salt is NOT secret material in the cryptographic sense (it can be
 * stored alongside the ciphertext) but the domain still treats it as
 * a sealed buffer to keep the API symmetric with the actual key VOs
 * (`MasterKey`, `DerivedKey`) and to prevent accidental in-place
 * mutation.
 *
 * Invariants:
 * - The wrapped buffer length is `>= MIN_SALT_LENGTH_BYTES`.
 * - Instances are immutable: the constructor clones the input and
 *   `withBytes(callback)` exposes a fresh defensive copy on each call.
 *
 * Equality:
 * - Two `SaltBytes` instances are equal iff their byte content matches
 *   exactly.
 */
export class SaltBytes {
  private readonly bytes: Uint8Array;

  private constructor(bytes: Uint8Array) {
    // Defensive copy: callers MUST NOT be able to mutate our internal
    // buffer after construction.
    this.bytes = new Uint8Array(bytes);
  }

  /**
   * Builds a `SaltBytes` from a raw `Uint8Array`. Validates the
   * minimum length and clones the input so the VO owns its buffer.
   */
  public static from(raw: Uint8Array): SaltBytes {
    if (!(raw instanceof Uint8Array)) {
      throw new InvalidInputError("salt must be a Uint8Array", {
        field: "kdf_params.salt",
      });
    }
    if (raw.length < MIN_SALT_LENGTH_BYTES) {
      throw new InvalidInputError(
        `salt must be at least ${String(MIN_SALT_LENGTH_BYTES)} bytes (got: ${String(raw.length)})`,
        { field: "kdf_params.salt" },
      );
    }
    return new SaltBytes(raw);
  }

  /**
   * Length of the wrapped buffer, in bytes. Useful for diagnostics
   * without exposing the bytes themselves.
   */
  public length(): number {
    return this.bytes.length;
  }

  /**
   * Exposes the wrapped bytes via a callback. The buffer passed to
   * the callback is a fresh defensive copy, so the caller can do
   * whatever it wants with it without affecting the VO.
   *
   * The callback pattern (rather than a getter) keeps the API
   * symmetric with `MasterKey` / `DerivedKey` / `Passphrase` even
   * though the salt itself is not secret. Symmetry pays off: the
   * codebase rule "secret material never leaves a VO via getter" is
   * easy to enforce when ALL crypto VOs follow it.
   */
  public withBytes<TResult>(
    callback: (bytes: Uint8Array<ArrayBuffer>) => TResult,
  ): TResult {
    const copy = new Uint8Array(this.bytes);
    return callback(copy);
  }

  /**
   * Constant-time-ish equality by content. Strict constant-time
   * comparison is only required for secret material; salt does not
   * need it but we still iterate the whole array without short-circuit
   * to keep the implementation reusable.
   */
  public equals(other: SaltBytes): boolean {
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

  /** Exposes the configured minimum length for documentation/tests. */
  public static minLengthBytes(): number {
    return MIN_SALT_LENGTH_BYTES;
  }
}
