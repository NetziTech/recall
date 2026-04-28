/**
 * Driven (output) port abstracting the SQLite connection used by every
 * persistence adapter in the codebase.
 *
 * Why this lives in `shared/application/ports/`:
 * - All eight modules (workspace, memory, retrieval, curator, secrets,
 *   encryption, mcp-server, cli) persist to the same SQLite database
 *   (`<workspace>/.recall/recall.db`, see
 *   `docs/03-modelo-datos.md` §1 and `docs/06-stack-tecnico.md` §4).
 *   Pulling the connection abstraction into a single transversal port
 *   is therefore mandatory per `docs/12-lineamientos-arquitectura.md`
 *   §1.5 Regla 3 ("si dos o mas modulos necesitan una funcionalidad,
 *   esa funcionalidad se mueve a `shared/`").
 *
 * Why this is a *minimal* surface (not a wrapper of the full
 * `better-sqlite3-multiple-ciphers` API):
 * - SOLID-ISP: callers only need three operations — prepare a
 *   statement, exec arbitrary DDL, and run a closure inside a single
 *   transaction. Any richer API would force every adapter into a
 *   contract bigger than what it actually uses, which makes the test
 *   doubles in `tests/fixtures/` proportionally more expensive.
 * - SOLID-DIP: this port contains no reference to
 *   `better-sqlite3-multiple-ciphers` or any other concrete driver,
 *   so the domain stays pluggable (a future libsql adapter, an
 *   in-memory test double, etc., can implement it without ripple
 *   effects).
 *
 * Implementation expectations (live in
 * `shared/infrastructure/persistence/sqlite-database.ts`, see
 * `docs/12-lineamientos-arquitectura.md` §2):
 * - Adapter is built around `better-sqlite3-multiple-ciphers` with WAL
 *   mode and SQLCipher pragmas applied at construction
 *   (`docs/06-stack-tecnico.md` §4-5).
 * - Adapter loads the `sqlite-vec` extension before returning to the
 *   caller (it is required by the retrieval module).
 * - Adapter uses prepared statements exclusively; this port forbids
 *   string-interpolated SQL by simply not exposing a "run literal"
 *   method.
 *
 * Test doubles (live in `tests/fixtures/`):
 * - `FakeDatabaseConnection` backed by `better-sqlite3-multiple-ciphers`
 *   in `:memory:` mode — used by integration tests of every module.
 * - `InMemoryDatabaseConnection` (no SQL) — used by unit tests that
 *   only need to verify the use case calls `prepare`/`run` with the
 *   right SQL string and parameters.
 */

/**
 * Outcome of an INSERT/UPDATE/DELETE executed via a `PreparedStatement`.
 *
 * Mirrors `better-sqlite3`'s `RunResult` shape (see
 * https://github.com/WiseLibs/better-sqlite3/blob/HEAD/docs/api.md#runbindparameters---object)
 * but uses only the two fields callers actually need so the port stays
 * implementation-agnostic.
 *
 * Invariants:
 * - `changes` is a non-negative integer count of affected rows.
 * - `lastInsertRowid` is the rowid of the most recent INSERT issued
 *   through this statement; it is `bigint` if the database was opened
 *   in BigInt mode and `number` otherwise. Callers that need it must
 *   handle both arms (the codebase prefers UUID v7 ids stored in TEXT
 *   columns, so `lastInsertRowid` is rarely consulted).
 */
export interface RunResult {
  readonly changes: number;
  readonly lastInsertRowid: bigint | number;
}

/**
 * Compiled, parameter-bindable SQL statement.
 *
 * A `PreparedStatement` is obtained from `DatabaseConnection.prepare`
 * and may be reused across calls — driver-side caching is the
 * implementation's responsibility, not the port's.
 *
 * Invariants:
 * - All four read methods (`get`, `all`, `iterate`, `run`) execute the
 *   same compiled SQL but interpret the result differently:
 *     - `run`     : write paths; returns the affected-row count.
 *     - `get`     : single-row read; returns `undefined` when the query
 *                   produces no row.
 *     - `all`     : multi-row read; returns a *frozen* array (the port
 *                   contract requires `readonly`, so adapters MUST NOT
 *                   reuse a buffer between calls).
 *     - `iterate` : streaming read for cursor-style consumption; the
 *                   iterator MUST yield the rows in the order returned
 *                   by SQLite and complete deterministically.
 * - Read methods return `unknown` (or `readonly unknown[]` /
 *   `IterableIterator<unknown>`) by design. SQLite columns are not
 *   typed at the driver level, so a generic-on-the-method API would
 *   either degenerate into a cast or invite consumers to skip
 *   validation. The codebase rule (`docs/12 §1.6`: "Cualquier valor
 *   desconocido entra como `unknown` y se valida con Zod antes de
 *   usarse") applies: every repository adapter MUST run the row
 *   through a Zod schema (or an equivalent runtime parser) before
 *   trusting it. The port itself does not perform validation.
 *
 * Test guidance:
 * - Adapters and unit tests should use a `FakePreparedStatement` that
 *   captures the params passed to `run`/`get`/`all` so the use-case
 *   tests can assert SQL parameters without a real database.
 */
export interface PreparedStatement {
  /**
   * Executes the statement as a write. Returns the affected-row count
   * and the last inserted rowid. Used for INSERT/UPDATE/DELETE.
   */
  run(...params: readonly unknown[]): RunResult;

  /**
   * Executes the statement as a single-row read. Returns the raw row
   * as `unknown`, or `undefined` if the query yielded no row. The
   * caller MUST run the result through Zod (or an equivalent runtime
   * parser) before trusting any field; see the interface JSDoc for
   * the rationale.
   */
  get(...params: readonly unknown[]): unknown;

  /**
   * Executes the statement as a multi-row read. Returns a frozen
   * array of raw rows in the order produced by SQLite. Each entry is
   * `unknown` and MUST be validated with Zod (or equivalent) before
   * use.
   */
  all(...params: readonly unknown[]): readonly unknown[];

  /**
   * Executes the statement as a streaming read. Returns an iterator
   * that yields raw rows one by one. Used by the curator's bulk paths
   * (`docs/05-memoria-decay.md` §3) where a multi-thousand-row scan
   * would balloon memory if materialised eagerly via `all`. Each
   * yielded value is `unknown` and MUST be validated with Zod (or
   * equivalent) before use.
   */
  iterate(...params: readonly unknown[]): IterableIterator<unknown>;
}

/**
 * Driven (output) port: SQLite connection abstraction.
 *
 * A `DatabaseConnection` is *one* connection backed by one file (or
 * `:memory:` for tests). The composition root opens it once at server
 * startup; every repository receives it via constructor injection.
 *
 * Contracts:
 * - `prepare` is idempotent for the same SQL string within the same
 *   connection: implementations MAY cache the compiled statement, but
 *   callers MUST NOT rely on identity (`===`) between two prepares of
 *   the same SQL.
 * - `exec` is reserved for DDL and migration scripts that contain
 *   multi-statement SQL; do NOT use it to bind user data.
 * - `transaction` is synchronous: the closure executes inside a
 *   `BEGIN` / `COMMIT` pair on success, or a `ROLLBACK` on throw. The
 *   closure MUST NOT escape its scope (no `setTimeout`, no `await`)
 *   because better-sqlite3's transactions are synchronous by design
 *   (see `docs/06-stack-tecnico.md` §4 footnote on the sync model).
 *   For nested savepoint logic, build it on top of this primitive in
 *   the adapter — the port intentionally keeps the surface small.
 * - `close` is idempotent: calling it twice MUST NOT throw. After
 *   `close`, every subsequent call to `prepare`/`exec`/`transaction`
 *   throws.
 *
 * Performance expectations
 * (per `docs/01-arquitectura.md` §10 / `docs/06-stack-tecnico.md` §4):
 * - WAL mode + `synchronous=NORMAL` so concurrent reads do not block
 *   on a single writer.
 * - `cache_size = -64000` and `temp_store = MEMORY` to keep hot reads
 *   off disk.
 * - The recall pipeline expects p95 < 50 ms for a single FTS5+vector
 *   round trip; any adapter that cannot meet that contract has to
 *   document the deviation.
 */
export interface DatabaseConnection {
  /**
   * Compiles `sql` and returns a reusable, parameter-bindable
   * statement. The compiled statement is owned by the connection and
   * reset/disposed when the connection closes.
   */
  prepare(sql: string): PreparedStatement;

  /**
   * Executes one or more SQL statements without binding parameters.
   * Reserved for DDL (migrations) and pragmas; the port forbids
   * passing user data through this path.
   */
  exec(sql: string): void;

  /**
   * Runs `fn` inside a single SQLite transaction.
   *
   * - On normal return, the transaction is committed and the result of
   *   `fn` is returned.
   * - On thrown exception, the transaction is rolled back and the
   *   exception is rethrown unchanged.
   *
   * The closure is synchronous; do not `await` inside it. For
   * write-then-read flows that need a consistent snapshot, group every
   * statement inside a single `transaction(...)` call.
   */
  transaction<T>(fn: () => T): T;

  /**
   * Releases the underlying connection and any compiled statements.
   * Idempotent.
   */
  close(): void;
}
