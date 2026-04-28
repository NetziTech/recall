import BetterSqlite3 from "better-sqlite3-multiple-ciphers";
import * as sqliteVec from "sqlite-vec";

import type {
  DatabaseConnection,
  PreparedStatement,
  RunResult,
} from "../../application/ports/database-connection.port.ts";
import type { Logger } from "../../application/ports/logger.port.ts";
import { DatabaseError } from "../errors/database-error.ts";

/**
 * Minimal handle on raw key bytes.
 *
 * **Why a local interface and not `DerivedKey` from
 * `modules/encryption/domain/`:**
 * - `shared/infrastructure/` is forbidden from importing from
 *   `modules/*` (the modularity rules of `docs/12 §1.5` Regla 1 and the
 *   ADR-001 carve-out are limited to `retrieval`/`curator` → `memory`).
 * - Pulling `DerivedKey` here would invert the dependency graph
 *   (`shared` would depend on `encryption`).
 * - The adapter only needs the raw bytes plus the security guarantee
 *   that the bytes are constant-time-comparable; both `DerivedKey` and
 *   any future test fixture can wrap themselves in `EncryptionKeyBytes`
 *   on the way in.
 *
 * Invariants (enforced by the caller, not by this interface):
 * - `bytes` MUST be 32 bytes long for a SQLCipher v4 default key.
 * - `bytes` MUST NOT escape the call stack of `SqliteDatabase.open()`.
 *   The adapter copies the bytes into the SQLCipher driver and never
 *   retains a reference (the underlying `Buffer` slot inside
 *   better-sqlite3 is the implementation's concern).
 */
export interface EncryptionKeyBytes {
  readonly bytes: Uint8Array;
}

/**
 * Construction options for {@link SqliteDatabase.open}.
 *
 * - `path` — absolute path to the SQLite file. Use `":memory:"` for
 *   in-memory tests.
 * - `encryptionKey` — when provided, the adapter applies SQLCipher
 *   pragmas on the freshly opened connection to unlock (or initialise)
 *   the database with this key. Validated by issuing a simple
 *   `SELECT count(*) FROM sqlite_master`; if the wrong key is supplied
 *   the adapter throws `DatabaseError.encryptionKeyRejected`.
 * - `readonly` — when `true`, opens the connection in read-only mode.
 *   WAL mode pragma is still applied (read-only WAL is supported).
 * - `loadVectorExtension` — when `true` (default), loads the
 *   `sqlite-vec` extension. The retrieval module needs it; degraded
 *   modes (e.g. CLI sub-commands that only touch metadata) MAY pass
 *   `false` to skip the load.
 * - `logger` — receives diagnostic events (extension load, fatal
 *   errors). Required so the adapter is testable without a console
 *   sink.
 */
export interface SqliteDatabaseOpenOptions {
  readonly path: string;
  readonly encryptionKey?: EncryptionKeyBytes | undefined;
  readonly readonly?: boolean | undefined;
  readonly loadVectorExtension?: boolean | undefined;
  readonly logger: Logger;
}

interface BetterSqlite3Database {
  pragma(source: string, options?: { simple?: boolean }): unknown;
  prepare(source: string): BetterSqlite3Statement;
  exec(source: string): unknown;
  transaction<F extends (...args: never[]) => unknown>(
    fn: F,
  ): {
    immediate(...args: Parameters<F>): ReturnType<F>;
  };
  loadExtension(file: string): unknown;
  close(): unknown;
  open: boolean;
}

interface BetterSqlite3Statement {
  run(...params: readonly unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(...params: readonly unknown[]): unknown;
  all(...params: readonly unknown[]): readonly unknown[];
  iterate(...params: readonly unknown[]): IterableIterator<unknown>;
}

/**
 * Wraps a {@link BetterSqlite3Statement} as a port-compliant
 * {@link PreparedStatement}.
 *
 * The wrapper exists for two reasons:
 * 1. The port returns frozen `readonly unknown[]` from `all()`. Without
 *    this wrapper, callers would receive the (mutable) array
 *    better-sqlite3 returns. We freeze a shallow copy on the way out.
 * 2. The port surfaces a stable error class. Library-thrown errors
 *    (e.g. SQLite syntax errors at run time) are wrapped in
 *    `DatabaseError`.
 */
class SqliteStatement implements PreparedStatement {
  public constructor(
    private readonly stmt: BetterSqlite3Statement,
    private readonly sql: string,
  ) {}

  public run(...params: readonly unknown[]): RunResult {
    try {
      const result = this.stmt.run(...params);
      return {
        changes: result.changes,
        lastInsertRowid: result.lastInsertRowid,
      };
    } catch (cause: unknown) {
      throw DatabaseError.execFailed(cause);
    }
  }

  public get(...params: readonly unknown[]): unknown {
    try {
      return this.stmt.get(...params);
    } catch (cause: unknown) {
      throw DatabaseError.execFailed(cause);
    }
  }

  public all(...params: readonly unknown[]): readonly unknown[] {
    try {
      const rows = this.stmt.all(...params);
      // Freeze a shallow copy: the port contract is `readonly`, callers
      // must not be able to mutate either the returned array or have it
      // mutated under them by the driver reusing buffers.
      return Object.freeze([...rows]);
    } catch (cause: unknown) {
      throw DatabaseError.execFailed(cause);
    }
  }

  public iterate(...params: readonly unknown[]): IterableIterator<unknown> {
    try {
      return this.stmt.iterate(...params);
    } catch (cause: unknown) {
      throw DatabaseError.execFailed(cause);
    }
  }

  /** Diagnostic helper — used by the adapter to report `prepare-failed`. */
  public source(): string {
    return this.sql;
  }
}

/**
 * SQLite connection adapter implementing
 * {@link DatabaseConnection}.
 *
 * Backed by `better-sqlite3-multiple-ciphers` so the adapter can speak
 * SQLCipher v4 when the workspace is in `encrypted` mode
 * (`docs/06-stack-tecnico.md` §4-5,
 * `docs/11-seguridad-modos.md` §3).
 *
 * Lifecycle:
 * 1. The composition root calls {@link SqliteDatabase.open} once at
 *    server start-up, optionally passing an encryption key.
 * 2. Open applies, in order:
 *      a. SQLCipher pragmas (cipher + key) — MUST come before any read
 *         or pragma that would touch the database header, otherwise
 *         SQLCipher rejects subsequent operations.
 *      b. `journal_mode = WAL` (`docs/06 §4`).
 *      c. `synchronous = NORMAL` (`docs/06 §4`).
 *      d. `foreign_keys = ON` (per `docs/03 §4` foreign keys).
 *      e. `cache_size = -64000` and `temp_store = MEMORY`.
 *      f. `sqlite-vec` extension load (best-effort; degrades to a
 *         warning in the logger if the platform binary is missing —
 *         the FTS5 fallback path in retrieval handles the absence,
 *         see `docs/01 §2.7`).
 *    A `SELECT count(*) FROM sqlite_master` round-trip validates the
 *    key after step (a). On failure, the adapter throws
 *    `DatabaseError.encryptionKeyRejected` and closes the underlying
 *    handle.
 *
 * Errors:
 * - {@link DatabaseError.openFailed} on file open or pragma failure.
 * - {@link DatabaseError.encryptionKeyRejected} on key mismatch.
 * - {@link DatabaseError.extensionLoadFailed} only when callers pass
 *   `loadVectorExtension: true` and the load throws AND we want to
 *   surface it as fatal. By default the adapter logs a warning and
 *   continues so that read-only/CLI flows that don't need vectors
 *   stay healthy.
 * - {@link DatabaseError.connectionClosed} on any operation against a
 *   closed connection.
 *
 * Composition root example:
 * ```typescript
 * const db = await SqliteDatabase.open({
 *   path: path.join(workspaceRoot, ".recall/recall.db"),
 *   encryptionKey: derivedKey, // or undefined for shared/private modes
 *   logger,
 * });
 * try {
 *   const runner = new MigrationsRunner(logger);
 *   await runner.run(db, path.join(__dirname, "..", "..", "..", "migrations"));
 *   // ... wire repositories with `db` ...
 * } finally {
 *   db.close();
 * }
 * ```
 */
export class SqliteDatabase implements DatabaseConnection {
  private isClosed: boolean;

  private constructor(private readonly db: BetterSqlite3Database) {
    this.isClosed = false;
  }

  /**
   * Opens a SQLite connection at `options.path`, applies SQLCipher (if
   * a key was provided), WAL, foreign keys and cache pragmas, and loads
   * `sqlite-vec`. Returns a ready-to-use adapter.
   *
   * Synchronous despite the `Promise` return type: the heavy work is
   * already synchronous in better-sqlite3, but the signature is
   * `Promise<...>` to leave room for a future libsql adapter that
   * opens over a network socket. The body is non-`async` (no `await`
   * is necessary today) to satisfy the lint rule
   * `@typescript-eslint/require-await`; we return via
   * `Promise.resolve(...)` so callers can `await` uniformly.
   */
  public static open(
    options: SqliteDatabaseOpenOptions,
  ): Promise<SqliteDatabase> {
    const { path: dbPath, encryptionKey, readonly: ro, loadVectorExtension, logger } = options;
    const shouldLoadVec = loadVectorExtension ?? true;

    let raw: BetterSqlite3Database;
    try {
      raw = new BetterSqlite3(dbPath, {
        readonly: ro ?? false,
      }) as unknown as BetterSqlite3Database;
    } catch (cause: unknown) {
      throw DatabaseError.openFailed(dbPath, cause);
    }

    // 1. SQLCipher unlock — must be the first operation on the handle.
    if (encryptionKey !== undefined) {
      try {
        SqliteDatabase.applyEncryptionKey(raw, encryptionKey);
      } catch (cause: unknown) {
        SqliteDatabase.safeClose(raw);
        throw DatabaseError.encryptionKeyRejected(cause);
      }
    }

    // 2. Performance + safety pragmas. WAL must be set even on read-only
    //    handles so concurrent writers in another process don't block.
    try {
      raw.pragma("journal_mode = WAL");
      raw.pragma("synchronous = NORMAL");
      raw.pragma("foreign_keys = ON");
      raw.pragma("cache_size = -64000");
      raw.pragma("temp_store = MEMORY");
    } catch (cause: unknown) {
      SqliteDatabase.safeClose(raw);
      throw DatabaseError.openFailed(dbPath, cause);
    }

    // 3. Load sqlite-vec. Degrade with a warning when it cannot load —
    //    the FTS5 fallback path keeps the server functional.
    if (shouldLoadVec) {
      try {
        const extensionPath = sqliteVec.getLoadablePath();
        raw.loadExtension(extensionPath);
        logger.debug(
          { extensionPath },
          "sqlite-vec extension loaded successfully",
        );
      } catch (cause: unknown) {
        // Best-effort: log and continue. Callers that REQUIRE vectors
        // (the retrieval module) will fail loudly when they try to
        // query a vec-backed table.
        logger.warn(
          {
            err: cause instanceof Error ? cause.message : String(cause),
          },
          "sqlite-vec extension failed to load; vector search will be unavailable",
        );
      }
    }

    return Promise.resolve(new SqliteDatabase(raw));
  }

  public prepare(sql: string): PreparedStatement {
    this.assertOpen("prepare");
    let stmt: BetterSqlite3Statement;
    try {
      stmt = this.db.prepare(sql);
    } catch (cause: unknown) {
      throw DatabaseError.prepareFailed(sql, cause);
    }
    return new SqliteStatement(stmt, sql);
  }

  public exec(sql: string): void {
    this.assertOpen("exec");
    try {
      this.db.exec(sql);
    } catch (cause: unknown) {
      throw DatabaseError.execFailed(cause);
    }
  }

  public transaction<T>(fn: () => T): T {
    this.assertOpen("transaction");
    try {
      // `immediate` mode acquires the write lock at BEGIN time. This
      // avoids the "BEGIN DEFERRED then upgrade to write" race that
      // FTS5 + sqlite-vec triggers can hit when the curator runs
      // concurrently with a recall (`docs/05 §3`).
      const tx = this.db.transaction(fn);
      return tx.immediate();
    } catch (cause: unknown) {
      // better-sqlite3 already rolled back on throw. We rethrow as a
      // tagged DatabaseError so the application layer can decide
      // whether to retry. The original cause stays attached.
      if (cause instanceof DatabaseError) {
        // The closure already wrapped its own error; let it bubble
        // unchanged so callers see the *original* code (e.g.
        // `database.exec-failed`) rather than a meta-wrapper.
        throw cause;
      }
      throw DatabaseError.transactionFailed(cause);
    }
  }

  public close(): void {
    if (this.isClosed) return;
    this.isClosed = true;
    SqliteDatabase.safeClose(this.db);
  }

  /**
   * Applies SQLCipher pragmas using a hex-encoded key.
   *
   * The hex form (`x'<hex>'`) is the canonical SQLCipher key format:
   * it bypasses any KDF the driver would apply over a raw passphrase
   * because the bytes ARE already a derived 32-byte key. This matches
   * the contract of `modules/encryption/domain/` — the KDF service in
   * the encryption module derives the key from the user's passphrase
   * and hands the bytes to this adapter.
   */
  private static applyEncryptionKey(
    db: BetterSqlite3Database,
    key: EncryptionKeyBytes,
  ): void {
    const hex = SqliteDatabase.bytesToHex(key.bytes);
    // Order matters: cipher first so the driver knows which KDF schema
    // to apply (the SQLCipher v4 default in this case), THEN the key.
    db.pragma(`cipher='sqlcipher'`);
    db.pragma(`key="x'${hex}'"`);
    // Validate the key is correct by reading the header. SQLCipher
    // refuses every operation with a misleading "file is not a database"
    // when the key is wrong — this single read surfaces it
    // deterministically here, before any caller statement runs.
    db.prepare("SELECT count(*) FROM sqlite_master").get();
  }

  private static bytesToHex(bytes: Uint8Array): string {
    let hex = "";
    for (const byte of bytes) {
      hex += byte.toString(16).padStart(2, "0");
    }
    return hex;
  }

  private static safeClose(db: BetterSqlite3Database): void {
    try {
      if (db.open) {
        db.close();
      }
    } catch {
      // Closing a half-open handle MUST NOT mask the original error.
    }
  }

  private assertOpen(operation: string): void {
    if (this.isClosed) {
      throw DatabaseError.connectionClosed(operation);
    }
  }
}
