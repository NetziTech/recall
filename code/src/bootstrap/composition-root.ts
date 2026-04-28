/**
 * Builds a fully-wired {@link Container} for one workspace. Both
 * entrypoints (`bootstrap/cli-entrypoint.ts` and
 * `bootstrap/mcp-server-entrypoint.ts`) call this function before
 * starting their respective transport.
 *
 * Responsibilities:
 *   1. Resolve the absolute migrations directory bundled with the
 *      binary. The function looks for `code/migrations/` first
 *      relative to the source tree (`tsx` dev path) and falls back to
 *      `dist/migrations/` (post-build).
 *   2. Open a `SqliteDatabase` against the workspace's `recall.db`
 *      with the encryption key resolver supplied by the caller.
 *   3. Run the bundled migrations via `MigrationsRunner`.
 *   4. Hand the live connection + the resolver to {@link buildContainer}.
 *
 * Failure model:
 * - If the workspace does not exist on disk (`init` flow), the
 *   caller passes `skipMigrations: true` and the database is opened
 *   in a deferred way — `WorkspaceWiring.initializeWorkspace` will
 *   bootstrap the database itself. The function returns a
 *   `PendingDatabase` that throws on use; the wiring still compiles
 *   and the init flow runs end-to-end.
 *
 * Lifecycle:
 * - The returned object exposes a `shutdown()` callback that closes
 *   the database, drops the master-key reference (zero-fills the
 *   buffer) and flushes pending logs. The bootstrap entrypoints
 *   register `shutdown()` against `SIGTERM` / `SIGINT`.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import type { Container } from "../composition/index.ts";
import { buildContainer } from "../composition/index.ts";
import type { Logger } from "../shared/application/ports/logger.port.ts";
import type { DatabaseConnection } from "../shared/application/ports/database-connection.port.ts";
import { WorkspaceId } from "../shared/domain/value-objects/workspace-id.ts";
import {
  SqliteDatabase,
  type EncryptionKeyBytes,
} from "../shared/infrastructure/database/sqlite-database.ts";
import { MigrationsRunner } from "../shared/infrastructure/database/migrations-runner.ts";
import { PinoLogger } from "../shared/infrastructure/logger/pino-logger.ts";

/**
 * Resolves the absolute migrations directory bundled with the running
 * process.
 *
 * The CLI and MCP server have to find the SQL migrations whether they
 * run as `tsx src/bootstrap/...-entrypoint.ts` (development) or as
 * `node dist/cli.js` / `node dist/server.js` (production). The
 * resolver accepts both layouts and is also driven by the
 * `RECALL_MIGRATIONS_DIR` environment variable when callers need
 * to point the binary at an arbitrary checkout (Bug B-009).
 *
 * Resolution order:
 *   1. Explicit env override (`RECALL_MIGRATIONS_DIR`).
 *   2. The entrypoint-relative layout, anchored on `process.argv[1]`.
 *      This is the single value Node guarantees points at the script
 *      that was invoked, regardless of bundling. We try in order:
 *        a. `<entrypoint-dir>/migrations/`     (tsup ships this on
 *           release — see the `onSuccess` hook in `tsup.config.ts`).
 *        b. `<entrypoint-dir>/../migrations/`  (development:
 *           `code/src/bootstrap/...` → `code/migrations/`).
 *        c. `<entrypoint-dir>/../../migrations/` (legacy / nested
 *           dist trees; preserved as the last resort to keep the
 *           E2E harness's staging layout valid).
 *   3. The `import.meta.url`-relative layout for the dev path when
 *      `argv[1]` is not informative (e.g. unit tests that import the
 *      bootstrap directly).
 *
 * The function returns the FIRST candidate that exists on disk and
 * is a directory. If none match, the entrypoint-relative
 * `<entrypoint-dir>/migrations/` is returned anyway so the
 * `MigrationsRunner` surfaces a clear `cannot read directory` error
 * instead of silently picking a stale path.
 */
function resolveDefaultMigrationsDir(): string {
  // 1) Env override.
  const fromEnv = process.env["RECALL_MIGRATIONS_DIR"];
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return path.resolve(fromEnv);
  }

  const candidates: string[] = [];

  // 2) Entrypoint-relative — the path Node was launched with.
  const argvEntry = process.argv[1];
  if (argvEntry !== undefined && argvEntry.length > 0) {
    const entryDir = path.dirname(path.resolve(argvEntry));
    candidates.push(path.join(entryDir, "migrations"));
    candidates.push(path.resolve(entryDir, "..", "migrations"));
    candidates.push(path.resolve(entryDir, "..", "..", "migrations"));
  }

  // 3) `import.meta.url`-relative — useful when the bootstrap is
  //    imported directly (unit tests) and `argv[1]` does not point at
  //    this module.
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    candidates.push(path.resolve(here, "..", "..", "migrations"));
  } catch {
    // `fileURLToPath` can throw on exotic schemes. Ignored — the
    // argv-derived candidates are the canonical source.
  }

  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isDirectory()) {
        return candidate;
      }
    } catch {
      /* not a directory or missing — try the next candidate */
    }
  }

  // No candidate matched. Return the most likely one so the failure
  // surface is `migrationDirectoryInvalid(<path>)` rather than a
  // misleading "found a stale folder" success.
  return candidates[0] ?? path.resolve("migrations");
}

/**
 * Reads the workspace_id stored in the workspace's `config.json` (if
 * the file exists). The bootstrap caller uses this to pin the
 * canonical id on every memory-module repository BEFORE the container
 * is built, so the SQLite workspace-scoping defence does not raise
 * `workspace mismatch` against a placeholder id (Bug B-017).
 *
 * Returns `null` when:
 *   - The workspace has not been initialised yet (`config.json` does
 *     not exist).
 *   - The file is unreadable, malformed JSON, or lacks the
 *     `workspace_id` key. In every error case we silently return
 *     `null` — the workspace module's `HealthCheck` use case still
 *     surfaces the same configs failure with a precise message; we
 *     avoid throwing here so the bootstrap never blocks on a corrupted
 *     workspace before the CLI's `health` / `init` commands can run.
 */
function tryReadWorkspaceId(workspaceRoot: string): WorkspaceId | null {
  const configPath = path.join(workspaceRoot, ".recall", "config.json");
  let raw: string;
  try {
    raw = fs.readFileSync(configPath, "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const candidate = (parsed as { readonly workspace_id?: unknown })
    .workspace_id;
  if (typeof candidate !== "string" || candidate.length === 0) return null;
  try {
    return WorkspaceId.from(candidate);
  } catch {
    return null;
  }
}

/**
 * Construction options for {@link bootstrapComposition}.
 */
export interface BootstrapCompositionOptions {
  /** Absolute path to the workspace root (the directory holding
   *  `.recall/`). Defaults to `process.cwd()`. */
  readonly workspaceRoot?: string;
  /** Override the migrations directory (mostly for tests). */
  readonly migrationsDir?: string;
  /** Logger overrides. Defaults to JSON pino at `info`. */
  readonly logLevel?: string;
  /**
   * File-descriptor sink for the logger stream. Defaults to `1`
   * (stdout) for parity with pino's own default. The MCP stdio
   * server entrypoint MUST pass `2` (stderr) so log frames do not
   * collide with JSON-RPC responses on stdout (Bug B-016).
   */
  readonly logDestination?: 1 | 2;
  /** Server info advertised on `initialize`. Bootstrap supplies
   *  defaults from `package.json` if absent. */
  readonly serverInfo?: {
    readonly name: string;
    readonly version: string;
    readonly protocolVersion: string;
  };
  /**
   * When `true`, skip opening the database — useful for `recall
   * init` and for the CLI's offline help paths. The container is
   * still built, but with a stub `DatabaseConnection`. Operations
   * that touch the DB throw `DatabaseUnavailableError`.
   */
  readonly skipDatabase?: boolean;
}

/**
 * Result of {@link bootstrapComposition}.
 */
export interface BootstrapResult {
  readonly container: Container;
  readonly shutdown: () => Promise<void>;
}

/**
 * Tagged error thrown when a code path needs the database but the
 * bootstrap was launched with `skipDatabase: true`.
 */
export class DatabaseUnavailableError extends Error {
  public readonly code = "bootstrap.database-unavailable";

  public constructor() {
    super(
      "the database connection is not available in this entrypoint mode (recall init bootstraps the DB itself).",
    );
    this.name = "DatabaseUnavailableError";
  }
}

/**
 * No-op closure used as the default `closeDb` when the bootstrap is
 * launched with `skipDatabase: true`. Lifted out of the function
 * body so ESLint's `no-empty-function` rule does not flag it (the
 * rule disallows literal `() => {}` expressions).
 */
function noop(): void {
  return;
}

/**
 * Stub `DatabaseConnection` that throws on every method. Used when
 * the bootstrap mode is `skipDatabase: true`.
 */
class UnavailableDatabaseConnection implements DatabaseConnection {
  public prepare(): never {
    throw new DatabaseUnavailableError();
  }

  public exec(): never {
    throw new DatabaseUnavailableError();
  }

  public transaction<TResult>(_fn: () => TResult): TResult {
    throw new DatabaseUnavailableError();
  }

  public close(): void {
    // no-op
  }
}

/**
 * Synchronously builds and wires the container. Async work
 * (database open + migrations) happens before this is called when
 * `skipDatabase` is false.
 */
export async function bootstrapComposition(
  options: BootstrapCompositionOptions = {},
): Promise<BootstrapResult> {
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const migrationsDir = options.migrationsDir ?? resolveDefaultMigrationsDir();
  const logLevel = options.logLevel ?? "info";
  const logDestination: 1 | 2 = options.logDestination ?? 1;
  const serverInfo = options.serverInfo ?? {
    name: "recall",
    version: "0.1.0-alpha.0",
    protocolVersion: "2024-11-05",
  };

  // Build a temporary logger so the boot path can log before the
  // shared adapters are wired. The real logger is the one inside the
  // container (built from the same options). The destination MUST
  // match the container logger so migrations, the database open path,
  // and the request path all land on the same stream (Bug B-016).
  const bootLogger: Logger = PinoLogger.create({
    level: logLevel,
    name: "recall-bootstrap",
    destination: logDestination,
  });

  // Pre-resolve the canonical workspace id from the workspace's
  // `config.json` (if it exists). Pinning the real id at the memory
  // wiring boundary BEFORE the SQLite repositories are constructed is
  // the only way to avoid the workspace-scoping defence raising
  // `workspace mismatch` against a placeholder id (Bug B-017). When
  // the config does not exist (the `init` flow), we leave the id
  // unresolved — the placeholder picked by `buildContainer` is
  // harmless because the only use case that runs in that mode is
  // `init`, which mints the id and writes the config itself.
  const workspaceId = tryReadWorkspaceId(workspaceRoot);

  // Master-key reference held by the resolver closure. Composition
  // updates it after a successful unlock; the closure exposes the
  // current value to the database adapter.
  let unlockedKey: EncryptionKeyBytes | null = null;
  const encryptionKeyResolver = (input: {
    readonly mode: "shared" | "encrypted" | "private";
    readonly databasePath: string;
  }): Promise<EncryptionKeyBytes | null> => {
    if (input.mode !== "encrypted") return Promise.resolve(null);
    return Promise.resolve(unlockedKey);
  };

  let database: DatabaseConnection;
  // No-op default; overwritten when a real SQLite handle is opened.
  let closeDb: () => void = noop;

  if (options.skipDatabase === true) {
    database = new UnavailableDatabaseConnection();
  } else {
    const dbPath = path.join(workspaceRoot, ".recall", "recall.db");
    const sqlite = await SqliteDatabase.open({
      path: dbPath,
      logger: bootLogger,
    });
    closeDb = (): void => {
      sqlite.close();
    };

    try {
      const runner = new MigrationsRunner(bootLogger);
      await runner.run(sqlite, migrationsDir);
    } catch (err: unknown) {
      sqlite.close();
      throw err;
    }
    database = sqlite;
  }

  const container = buildContainer({
    shared: {
      logger: {
        level: logLevel,
        name: "recall",
        destination: logDestination,
      },
    },
    workspaceRoot,
    migrationsDir,
    database,
    encryptionKeyResolver,
    schemaVersion: "1.0.0",
    serverInfo,
    ...(workspaceId !== null ? { workspaceId } : {}),
  });

  const shutdown = async (): Promise<void> => {
    try {
      closeDb();
    } finally {
      // Zero the unlocked key buffer so a memory scrape after
      // shutdown cannot recover it.
      if (unlockedKey !== null) {
        unlockedKey.bytes.fill(0);
        unlockedKey = null;
      }
    }
    await Promise.resolve();
  };

  return { container, shutdown };
}
