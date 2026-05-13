import { InfrastructureError } from "./infrastructure-error.ts";

/**
 * Concrete error raised by the SQLite adapter wrappers.
 *
 * The `code` field is one of the kebab-case identifiers in
 * {@link DatabaseErrorCode}; callers SHOULD pattern-match on it rather
 * than parse the human-readable `message`.
 *
 * Why this exists in `shared/infrastructure/errors/` and not next to
 * the adapter:
 * - Both `sqlite-database.ts` and `migrations-runner.ts` raise the same
 *   family of errors (open failures, prepare failures, transaction
 *   rollback). Co-locating the type with the adapter would force the
 *   migrations runner to import from a sibling file purely for the
 *   error class — moving it up to `errors/` keeps the dependency graph
 *   linear (errors are leaves; adapters depend on them, never the
 *   reverse).
 *
 * Construction is via static factories (one per `code`) so that the
 * `code` literal cannot drift from the discriminator type.
 *
 * Path/identifier redaction (W-3.5-SEC-L1):
 * - Filesystem paths and similar leak-prone identifiers (e.g. the
 *   absolute path of the SQLite file, the migrations directory) are
 *   stored in the structured {@link DatabaseError.details} bag, NOT
 *   concatenated into `message`. Pino's redactor walks structured keys
 *   (see `DEFAULT_REDACT_PATHS` in `pino-logger.ts`) but does NOT
 *   inspect message content — keeping paths out of the message is
 *   what makes them redactable when these errors flow through the
 *   logger.
 * - Callers that need the path read it from `details.path` /
 *   `details.dir`. Tests that previously asserted on `error.message`
 *   substring should pivot to `error.details.path`.
 *
 * **WARNING — wire boundary (O-PR45-2, HANDOFF §8):** `details` MUST
 * NOT be serialised into the JSON-RPC `data` envelope of an MCP
 * response. Pino's redact globs (`details.path` / `details.dir`)
 * fire inside the logger; the wire serialiser is a different code
 * path. The MCP facade that converts a `DatabaseError` into a
 * `JsonRpcError` is responsible for picking the wire-safe fields
 * (e.g. `code`, redacted `message`) and explicitly dropping
 * `details`. Surfacing `details.path` over the wire would leak the
 * workspace absolute path to the LLM transcript — the exact threat
 * §3 of `docs/11-seguridad-modos.md` warns against.
 */
export type DatabaseErrorCode =
  | "database.open-failed"
  | "database.encryption-key-rejected"
  | "database.extension-load-failed"
  | "database.prepare-failed"
  | "database.exec-failed"
  | "database.transaction-failed"
  | "database.connection-closed"
  | "database.migration-ahead-of-code"
  | "database.migration-failed"
  | "database.migration-directory-invalid";

/**
 * Structured side-channel for sensitive or operationally-useful
 * identifiers attached to a {@link DatabaseError}.
 *
 * The bag is populated by the static factories; callers MUST treat it
 * as read-only. Keys are lowercase ASCII; values are JSON-serializable
 * primitives (no nested objects yet — kept narrow on purpose so the
 * pino redact globs `*.details.path` / `*.details.dir` match cleanly
 * without `**` recursion).
 */
export type DatabaseErrorDetails = Readonly<Record<string, unknown>>;

export class DatabaseError extends InfrastructureError {
  public readonly code: DatabaseErrorCode;

  /**
   * Structured fields that supplement {@link Error.message} without
   * appearing inside the message string. Always defined (empty object
   * when a factory has nothing to attach) so callers can dot-access
   * `details.path` without an undefined-guard.
   */
  public readonly details: DatabaseErrorDetails;

  private constructor(
    code: DatabaseErrorCode,
    message: string,
    details: DatabaseErrorDetails,
    cause?: unknown,
  ) {
    super(message, cause);
    this.code = code;
    this.details = details;
  }

  public static openFailed(path: string, cause: unknown): DatabaseError {
    return new DatabaseError(
      "database.open-failed",
      "failed to open SQLite database",
      { path },
      cause,
    );
  }

  public static encryptionKeyRejected(cause: unknown): DatabaseError {
    return new DatabaseError(
      "database.encryption-key-rejected",
      "encryption key was rejected by SQLCipher (wrong key or corrupted DB header)",
      {},
      cause,
    );
  }

  public static extensionLoadFailed(
    extensionName: string,
    cause: unknown,
  ): DatabaseError {
    return new DatabaseError(
      "database.extension-load-failed",
      `failed to load SQLite extension "${extensionName}"`,
      { extensionName },
      cause,
    );
  }

  public static prepareFailed(sql: string, cause: unknown): DatabaseError {
    return new DatabaseError(
      "database.prepare-failed",
      `failed to prepare SQL statement (sql length=${String(sql.length)})`,
      { sqlLength: sql.length },
      cause,
    );
  }

  public static execFailed(cause: unknown): DatabaseError {
    return new DatabaseError(
      "database.exec-failed",
      "failed to execute SQL batch",
      {},
      cause,
    );
  }

  public static transactionFailed(cause: unknown): DatabaseError {
    return new DatabaseError(
      "database.transaction-failed",
      "transaction rolled back due to a thrown exception",
      {},
      cause,
    );
  }

  public static connectionClosed(operation: string): DatabaseError {
    return new DatabaseError(
      "database.connection-closed",
      `cannot ${operation}: database connection has been closed`,
      { operation },
    );
  }

  public static migrationAheadOfCode(
    dbVersion: number,
    codeMaxVersion: number,
  ): DatabaseError {
    return new DatabaseError(
      "database.migration-ahead-of-code",
      `database schema_migrations top version is ${String(dbVersion)} but code only ships migrations up to ${String(codeMaxVersion)}; refusing to start to avoid silent corruption`,
      { dbVersion, codeMaxVersion },
    );
  }

  public static migrationFailed(
    version: number,
    name: string,
    cause: unknown,
  ): DatabaseError {
    return new DatabaseError(
      "database.migration-failed",
      `migration ${String(version)} (${name}) failed and was rolled back`,
      { version, name },
      cause,
    );
  }

  public static migrationDirectoryInvalid(
    dir: string,
    reason: string,
  ): DatabaseError {
    return new DatabaseError(
      "database.migration-directory-invalid",
      `migrations directory is invalid: ${reason}`,
      { dir, reason },
    );
  }
}
