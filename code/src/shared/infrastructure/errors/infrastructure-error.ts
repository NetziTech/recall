/**
 * Base class for every error raised inside `shared/infrastructure/`.
 *
 * Why a dedicated class hierarchy:
 * - Adapters wrap third-party libraries (`better-sqlite3-multiple-ciphers`,
 *   `pino`, `fastembed`, `@noble/hashes`, `uuid`). Those libraries throw
 *   raw `Error` instances whose `message` is library-specific and whose
 *   stack does not point back to this codebase. Wrapping every external
 *   throw in a tagged subclass lets the application layer pattern-match
 *   on stable codes (e.g. `database.connection-failed`) without
 *   `instanceof XlibError` checks.
 * - The base class is INTENTIONALLY NOT a `DomainError` (see
 *   `shared/domain/errors/domain-error.ts`): infrastructure failures are
 *   not invariant violations of the model — they are operational
 *   failures of the surrounding world (disk full, key wrong, model not
 *   downloaded, ...). Leaking a domain error from the infra layer would
 *   miscategorise these for the JSON-RPC error mapper.
 *
 * Invariants:
 * - `code` is a stable kebab-case identifier scoped by adapter family
 *   (`database.<...>`, `embedder.<...>`, `crypto.<...>`, ...). Callers
 *   route on it; renaming an existing code is a breaking change.
 * - `cause` (when set) preserves the original exception thrown by the
 *   wrapped library, so a debugging human can still see the underlying
 *   stack via `error.cause`.
 *
 * Implementation note:
 * - The class is `abstract` so concrete subclasses are forced to declare
 *   their `code`. The only construction path callers should use is the
 *   subclass constructor.
 *
 * Example (composition root):
 * ```typescript
 * try {
 *   const db = SqliteDatabase.open({ path });
 * } catch (err) {
 *   if (err instanceof InfrastructureError && err.code === "database.open-failed") {
 *     logger.fatal({ err }, "cannot open workspace database; aborting");
 *     process.exit(1);
 *   }
 *   throw err;
 * }
 * ```
 */
export abstract class InfrastructureError extends Error {
  public abstract readonly code: string;

  protected constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = new.target.name;
    if (options?.cause !== undefined) {
      // `cause` is part of ES2022 Error options, but we set it explicitly
      // so that the property is non-enumerable (matches the convention in
      // `shared/domain/errors/domain-error.ts`).
      Object.defineProperty(this, "cause", {
        value: options.cause,
        enumerable: false,
        writable: false,
        configurable: true,
      });
    }
  }
}
