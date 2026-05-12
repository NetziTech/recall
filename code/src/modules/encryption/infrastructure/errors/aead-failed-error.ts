import { EncryptionInfrastructureError } from "./encryption-infrastructure-error.ts";

/**
 * Set of legal `AeadFailedKind` values.
 *
 * - `authentication-failed`: the AEAD tag did not verify under the
 *   candidate key. Surfaced by `EnvelopeCipher.unwrap`. NOT to be
 *   confused with `KeyValidationFailedError` from the domain: when
 *   *unwrap* fails, the validator does not even get a chance to run.
 * - `subtle-not-available`: the host runtime did not expose a Web
 *   Crypto AEAD (extremely rare on Node 20+).
 * - `library-failure`: any other thrown exception from the AEAD
 *   primitive that does not fit a more specific kind.
 * - `invalid-buffer-size`: a defensive check failed (e.g. tag length
 *   != 16). The domain VOs already enforce these invariants on
 *   construction; this kind exists for the case where the adapter
 *   builds the buffers itself (wrap path).
 */
const AEAD_FAILED_KINDS = [
  "authentication-failed",
  "subtle-not-available",
  "library-failure",
  "invalid-buffer-size",
] as const;

export type AeadFailedKind = (typeof AEAD_FAILED_KINDS)[number];

/**
 * Thrown when the AEAD wrap or unwrap operation fails.
 *
 * Why distinct from `KeyValidationFailedError` (domain):
 * - The domain-level error is raised by `EncryptionConfig.unlockWith`
 *   when the validator says "your candidate master key does NOT decrypt
 *   the validator blob" — a user-visible outcome with a wire-level code.
 * - This infrastructure error is raised when the AEAD primitive itself
 *   refuses to operate: an envelope ciphertext with a corrupt tag, a
 *   missing `crypto.subtle`, etc. The adapters that consume it
 *   (`AesGcmEnvelopeCipher.unwrap`, `AesGcmKeyValidator.validate`) are
 *   responsible for converting `authentication-failed` into the
 *   appropriate domain-level outcome (e.g. returning `false` from
 *   `KeyValidator.validate`).
 *
 * Security invariants (inherited):
 * - The `message` MUST NOT include any byte of the master key, derived
 *   key, ciphertext, IV or tag. Lengths are public and may be quoted.
 *
 * Invariants:
 * - `code` is `crypto.aead-failed`.
 * - `kind` is one of `AEAD_FAILED_KINDS`.
 */
export class AeadFailedError extends EncryptionInfrastructureError {
  public readonly code = "crypto.aead-failed";
  public readonly kind: AeadFailedKind;

  private constructor(message: string, kind: AeadFailedKind, cause?: unknown) {
    super(message, cause);
    this.kind = kind;
  }

  public static authenticationFailed(cause?: unknown): AeadFailedError {
    return new AeadFailedError(
      "AEAD authentication failed: the supplied key cannot decrypt the ciphertext (wrong key or tampered blob)",
      "authentication-failed",
      cause,
    );
  }

  public static subtleNotAvailable(): AeadFailedError {
    return new AeadFailedError(
      "Web Crypto SubtleCrypto API is not available on this runtime",
      "subtle-not-available",
    );
  }

  public static libraryFailure(cause: unknown): AeadFailedError {
    return new AeadFailedError(
      "AEAD primitive failed inside the underlying library",
      "library-failure",
      cause,
    );
  }

  public static invalidBufferSize(
    fieldName: string,
    expected: number,
    actual: number,
  ): AeadFailedError {
    return new AeadFailedError(
      `AEAD ${fieldName} buffer size mismatch (expected ${String(expected)} bytes, got ${String(actual)})`,
      "invalid-buffer-size",
    );
  }

  public static isKind(candidate: string): candidate is AeadFailedKind {
    for (const known of AEAD_FAILED_KINDS) {
      if (known === candidate) return true;
    }
    return false;
  }
}
