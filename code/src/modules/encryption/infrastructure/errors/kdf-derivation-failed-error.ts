import { EncryptionInfrastructureError } from "./encryption-infrastructure-error.ts";

/**
 * Set of legal `KdfDerivationFailedKind` values. Single source of truth
 * for the union below; adding a new failure mode is a one-line change.
 *
 * - `algorithm-mismatch`: the supplied `KdfParams.algorithm` is not
 *   one the adapter knows how to compute (today only `argon2id`).
 * - `out-of-memory`: the underlying primitive refused the memory
 *   budget (RFC 9106 §3.1 caps `m` at platform-specific limits;
 *   noble-hashes surfaces this as an `Error`).
 * - `library-failure`: any other thrown exception from the underlying
 *   primitive that does not fit a more specific kind.
 */
const KDF_DERIVATION_FAILED_KINDS = [
  "algorithm-mismatch",
  "out-of-memory",
  "library-failure",
] as const;

export type KdfDerivationFailedKind =
  (typeof KDF_DERIVATION_FAILED_KINDS)[number];

/**
 * Thrown when the KDF adapter cannot produce a `DerivedKey`.
 *
 * Distinct from `KeyValidationFailedError` (domain):
 * - `KeyValidationFailedError` signals "the user-supplied passphrase
 *   produced bytes that did NOT decrypt the validator blob" — a normal
 *   user-input outcome, mapped to the wire-level `-32108 INVALID_KEY`.
 * - `KdfDerivationFailedError` signals "the KDF adapter could not run
 *   at all" — a system-level outcome, never user-visible as a typed
 *   error code. The composition root logs it and aborts.
 *
 * Security invariants (inherited from `EncryptionInfrastructureError`):
 * - The `message` MUST NOT include the passphrase or any derived bytes.
 *
 * Invariants:
 * - `code` is `crypto.kdf-derivation-failed`.
 * - `kind` is one of the values in `KDF_DERIVATION_FAILED_KINDS`.
 */
export class KdfDerivationFailedError extends EncryptionInfrastructureError {
  public readonly code = "crypto.kdf-derivation-failed";
  public readonly kind: KdfDerivationFailedKind;

  private constructor(
    message: string,
    kind: KdfDerivationFailedKind,
    cause?: unknown,
  ) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.kind = kind;
  }

  public static algorithmMismatch(actual: string): KdfDerivationFailedError {
    return new KdfDerivationFailedError(
      `KDF adapter does not support algorithm "${actual}" (expected "argon2id")`,
      "algorithm-mismatch",
    );
  }

  public static outOfMemory(cause: unknown): KdfDerivationFailedError {
    return new KdfDerivationFailedError(
      "argon2id derivation failed due to insufficient memory",
      "out-of-memory",
      cause,
    );
  }

  public static libraryFailure(cause: unknown): KdfDerivationFailedError {
    return new KdfDerivationFailedError(
      "argon2id derivation failed inside the underlying primitive",
      "library-failure",
      cause,
    );
  }

  public static isKind(candidate: string): candidate is KdfDerivationFailedKind {
    for (const known of KDF_DERIVATION_FAILED_KINDS) {
      if (known === candidate) return true;
    }
    return false;
  }
}
