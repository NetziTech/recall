import { InfrastructureError } from "../../../../shared/infrastructure/errors/infrastructure-error.ts";

/**
 * Base class for every error raised inside
 * `modules/encryption/infrastructure/`.
 *
 * Why a dedicated subclass of `InfrastructureError`:
 * - Adapters wrap third-party primitives (`@noble/hashes/argon2`,
 *   Node's Web Crypto AEAD, the OS CSPRNG). Those throw raw `Error`
 *   instances whose `message` is library-specific. Wrapping each
 *   external throw in a tagged subclass lets the application layer
 *   route on stable codes (e.g. `crypto.kdf-derivation-failed`)
 *   without `instanceof XlibError` checks. Mirrors the pattern
 *   adopted by `DatabaseError` / `EmbedderError` in
 *   `shared/infrastructure/errors/`.
 * - The hierarchy keeps `InfrastructureError` (not
 *   `EncryptionDomainError`) as the parent: cryptographic failures
 *   here are operational failures of the surrounding world
 *   (out-of-memory during argon2, missing `crypto.subtle`, tampered
 *   AEAD blob, ...) — NOT invariant violations of the domain model.
 *   Routing them as `InfrastructureError` lets the JSON-RPC error
 *   mapper treat them as standard internal errors rather than
 *   user-visible domain rejections (the domain still has its own
 *   `KeyValidationFailedError` for the user-visible "wrong key"
 *   outcome, raised at the aggregate level — not by these adapters).
 *
 * Why these errors are THROWN (not returned via `Result`):
 * - The application port `Kdf.derive(...)` returns
 *   `Result<DerivedKey, WeakKdfParamsError>`. Only the *expected,
 *   recoverable* failure mode (weak params) is typed in the result
 *   channel; infrastructure failures propagate as exceptions because
 *   typing them would force the application port to import from
 *   `infrastructure/errors/`, which crosses the layering boundary
 *   (`docs/12 §1.1`: application MUST NOT import from
 *   infrastructure).
 * - Catching `instanceof InfrastructureError` at the composition
 *   root is the documented pattern (see
 *   `shared/infrastructure/errors/infrastructure-error.ts` JSDoc
 *   "Example (composition root)").
 *
 * Security invariants (NON-NEGOTIABLE):
 * - Subclasses MUST NOT include passphrase characters, derived-key
 *   bytes, master-key bytes, AEAD tags or any other secret material in
 *   their `message`, in any data field, or in `cause`'s message. If
 *   the wrapped library leaks bytes through its own error message,
 *   the adapter MUST NOT propagate that message verbatim.
 * - Subclasses MAY carry length information (e.g. "expected 32 bytes,
 *   got 31") because lengths are public.
 *
 * Invariants:
 * - `code` is a stable kebab-case identifier scoped under the
 *   `crypto.` family.
 * - `cause` (when set) preserves the original exception thrown by the
 *   wrapped primitive.
 */
export abstract class EncryptionInfrastructureError extends InfrastructureError {
  protected constructor(message: string, options?: { cause?: unknown }) {
    super(
      message,
      options?.cause !== undefined ? { cause: options.cause } : undefined,
    );
  }
}
