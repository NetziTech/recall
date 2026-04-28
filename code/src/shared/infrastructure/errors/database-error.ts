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

export class DatabaseError extends InfrastructureError {
  public readonly code: DatabaseErrorCode;

  private constructor(
    code: DatabaseErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.code = code;
  }

  public static openFailed(path: string, cause: unknown): DatabaseError {
    return new DatabaseError(
      "database.open-failed",
      `failed to open SQLite database at ${path}`,
      cause,
    );
  }

  public static encryptionKeyRejected(cause: unknown): DatabaseError {
    return new DatabaseError(
      "database.encryption-key-rejected",
      "encryption key was rejected by SQLCipher (wrong key or corrupted DB header)",
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
      cause,
    );
  }

  public static prepareFailed(sql: string, cause: unknown): DatabaseError {
    return new DatabaseError(
      "database.prepare-failed",
      `failed to prepare SQL statement (sql length=${String(sql.length)})`,
      cause,
    );
  }

  public static execFailed(cause: unknown): DatabaseError {
    return new DatabaseError(
      "database.exec-failed",
      "failed to execute SQL batch",
      cause,
    );
  }

  public static transactionFailed(cause: unknown): DatabaseError {
    return new DatabaseError(
      "database.transaction-failed",
      "transaction rolled back due to a thrown exception",
      cause,
    );
  }

  public static connectionClosed(operation: string): DatabaseError {
    return new DatabaseError(
      "database.connection-closed",
      `cannot ${operation}: database connection has been closed`,
    );
  }

  public static migrationAheadOfCode(
    dbVersion: number,
    codeMaxVersion: number,
  ): DatabaseError {
    return new DatabaseError(
      "database.migration-ahead-of-code",
      `database schema_migrations top version is ${String(dbVersion)} but code only ships migrations up to ${String(codeMaxVersion)}; refusing to start to avoid silent corruption`,
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
      cause,
    );
  }

  public static migrationDirectoryInvalid(
    dir: string,
    reason: string,
  ): DatabaseError {
    return new DatabaseError(
      "database.migration-directory-invalid",
      `migrations directory ${dir} is invalid: ${reason}`,
    );
  }
}
