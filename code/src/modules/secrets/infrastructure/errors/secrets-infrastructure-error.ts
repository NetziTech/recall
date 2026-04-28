import { InfrastructureError } from "../../../../shared/infrastructure/errors/infrastructure-error.ts";

/**
 * Base class for every error raised inside
 * `modules/secrets/infrastructure/`.
 *
 * Why a dedicated subclass of `InfrastructureError`:
 * - Mirrors the pattern adopted by `EncryptionInfrastructureError`
 *   and the `shared/infrastructure/errors/database-error.ts` family.
 *   Adapters in this module wrap filesystem operations (the
 *   pre-commit hook installer) and SQLite operations (the audit
 *   repository, but most of its errors flow through `DatabaseError`
 *   already). Providing a tagged base lets the application layer
 *   route every secrets-related infra failure with a single
 *   `instanceof` test.
 *
 * Invariants:
 * - `code` is a stable kebab-case identifier scoped under the
 *   `secrets.` family (e.g. `secrets.foreign-hook-exists`).
 * - `cause` (when set) preserves the original exception thrown by
 *   the wrapped library.
 */
export abstract class SecretsInfrastructureError extends InfrastructureError {
  protected constructor(message: string, options?: { cause?: unknown }) {
    super(
      message,
      options?.cause !== undefined ? { cause: options.cause } : undefined,
    );
  }
}
