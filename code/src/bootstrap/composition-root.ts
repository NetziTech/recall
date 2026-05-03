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
 *   2. The entrypoint-relative layout, anchored on `process.argv[1]`
 *      AFTER `fs.realpathSync(...)` so symlinked global installs (the
 *      typical npm-global layout where `~/.nvm/.../bin/recall` is a
 *      symlink to `~/.nvm/.../lib/node_modules/@netzi/recall/dist/cli.js`)
 *      resolve to the real on-disk location of the bundle. Without
 *      this, `path.dirname(argvEntry)` returns `~/.nvm/.../bin/`,
 *      which contains no `migrations/` siblings (B-CLI-5). We try
 *      both the realpath-derived candidates and the literal-argv
 *      ones — the latter remains as a defensive fallback for hosts
 *      where `realpath` cannot be resolved (read-only mounts, exotic
 *      filesystem layouts).
 *
 *      For each anchor (`<entry-dir>`) we try, in order:
 *        a. `<entry-dir>/migrations/`      (tsup ships this on
 *           release — see the `onSuccess` hook in `tsup.config.ts`,
 *           and it is also the layout used by `npm install -g`).
 *        b. `<entry-dir>/../migrations/`   (development:
 *           `code/src/bootstrap/...` → `code/migrations/`).
 *        c. `<entry-dir>/../../migrations/` (legacy / nested dist
 *           trees; preserved as the last resort to keep the E2E
 *           harness's staging layout valid).
 *   3. The `import.meta.url`-relative layout for the dev / unit-test
 *      path when `argv[1]` is not informative (e.g. tests that
 *      import the bootstrap directly via tsx). Tries:
 *        a. `<here>/migrations/`           (post-build sibling of
 *           the bundled `cli.js`).
 *        b. `<here>/../../migrations/`     (dev path:
 *           `code/src/bootstrap/` → `code/migrations/`).
 *
 * The function returns the FIRST candidate that exists on disk and
 * is a directory. If none match, the first candidate is returned so
 * the failure surface is `migrationDirectoryInvalid(<path>)` rather
 * than a silently-picked stale folder.
 */
/**
 * Discriminator for the two anchor sources `collectFsCandidates`
 * walks. Resolvers can return different candidate paths per kind —
 * the migrations resolver, for instance, intentionally skips the
 * `<here>/../migrations` candidate under `importMeta` because that
 * path resolves to `code/src/migrations/` which never exists.
 */
type AnchorKind = "argv" | "importMeta";

/**
 * Walks both filesystem anchors the bootstrap can use to find
 * sibling files (`migrations/`, `package.json`, future helpers...):
 *
 *   1. The `argv[1]` entrypoint, with `fs.realpathSync` to follow
 *      npm-global symlinks (see B-CLI-5 for the failure mode this
 *      avoids). Both the realpath-derived AND the literal-argv
 *      anchors are tried in case `realpath` is unavailable.
 *   2. `import.meta.url`, useful for unit tests + tsx-imported
 *      bootstrap paths where `argv[1]` does not point at this file.
 *
 * For every anchor, the caller supplies a `builder(anchor, kind)`
 * that returns the candidate paths it wants to try (already in
 * priority order). Returned paths are de-duplicated globally so the
 * common dev case (realpath = literal) does not double-stat each
 * candidate.
 *
 * Extracted from {@link resolveDefaultMigrationsDir} when
 * {@link resolvePackageVersion} grew the same anchor-walking
 * boilerplate; see Sonar S4144 and S3776 (PR #37 round 2).
 */
function collectFsCandidates(
  builder: (anchor: string, kind: AnchorKind) => readonly string[],
): readonly string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const push = (candidate: string): void => {
    if (seen.has(candidate)) return;
    seen.add(candidate);
    candidates.push(candidate);
  };

  const argvEntry = process.argv[1];
  if (argvEntry !== undefined && argvEntry.length > 0) {
    const literalEntry = path.resolve(argvEntry);
    let realEntry: string | null = null;
    try {
      realEntry = fs.realpathSync(literalEntry);
    } catch {
      realEntry = null;
    }
    if (realEntry !== null) {
      for (const c of builder(path.dirname(realEntry), "argv")) push(c);
    }
    for (const c of builder(path.dirname(literalEntry), "argv")) push(c);
  }

  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    for (const c of builder(here, "importMeta")) push(c);
  } catch {
    /* `fileURLToPath` can throw on exotic schemes — argv anchor is canonical anyway */
  }

  return candidates;
}

function resolveDefaultMigrationsDir(): string {
  // Env override short-circuits both anchor walks.
  const fromEnv = process.env["RECALL_MIGRATIONS_DIR"];
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return path.resolve(fromEnv);
  }

  const candidates = collectFsCandidates((anchor, kind) => {
    if (kind === "argv") {
      // Three candidates per binary anchor:
      //   a. `<entry>/migrations`        — tsup `onSuccess` ships
      //      migrations alongside the bundle on release.
      //   b. `<entry>/../migrations`     — dev path: `code/src/
      //      bootstrap/` → `code/migrations/`.
      //   c. `<entry>/../../migrations`  — legacy / nested dist
      //      trees; preserved as the last resort to keep the E2E
      //      harness's staging layout valid.
      return [
        path.join(anchor, "migrations"),
        path.resolve(anchor, "..", "migrations"),
        path.resolve(anchor, "..", "..", "migrations"),
      ];
    }
    // `importMeta`: only two candidates — the `<here>/../migrations`
    // path would resolve to `code/src/migrations/` which never exists
    // in any supported layout.
    return [
      path.resolve(anchor, "migrations"),
      path.resolve(anchor, "..", "..", "migrations"),
    ];
  });

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
 * Resolves the optional override for the stdio frame-accumulator
 * cap (W-3.1-SEC-M1).
 *
 * Reads `RECALL_MCP_MAX_BUFFER_BYTES`. When set to a positive
 * integer, the bootstrap forwards the value into the container's
 * `mcpStdioMaxBufferBytes` slot, which the MCP wiring forwards to
 * `StdioJsonRpcServer` as `maxBufferBytes`. When the env var is
 * absent OR malformed (non-numeric, non-positive, non-finite), the
 * adapter falls back to its built-in default (`DEFAULT_MAX_BUFFER_BYTES`,
 * 10 MiB).
 *
 * Returns `null` to communicate "no override" to the caller — that
 * lets the caller spread the result conditionally and keep
 * `exactOptionalPropertyTypes` happy.
 *
 * Malformed values (e.g. `"hello"`, `"-1"`) are silently ignored
 * rather than thrown: the bootstrap path MUST stay robust against
 * a misconfigured environment so the binary still starts and the
 * canonical default applies. Operators see the failure in any
 * subsequent overflow log payload, which records the active cap.
 */
function resolveMcpStdioMaxBufferBytes(): number | null {
  const raw = process.env["RECALL_MCP_MAX_BUFFER_BYTES"];
  if (raw === undefined || raw.length === 0) return null;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

/**
 * Sentinel returned when {@link resolvePackageVersion} cannot locate
 * or parse the bundled `package.json`. Returning a clearly-fake
 * version (rather than throwing) lets the bootstrap proceed — the
 * value surfaces on `initialize.serverInfo.version` so any client
 * inspecting the handshake immediately sees something is off, while
 * tools/calls keep working.
 */
const UNKNOWN_PACKAGE_VERSION = "0.0.0-unknown";

/**
 * Reads the package version from the bundled `package.json`.
 *
 * The literal that used to live inline at the
 * `bootstrapComposition.serverInfo.version` callsite drifted out of
 * sync with `code/package.json` twice (beta.4 and beta.5 releases —
 * see HANDOFF §6.20). Reading the value at runtime eliminates the
 * disciplinary requirement to update two files on every bump.
 *
 * Resolution mirrors {@link resolveDefaultMigrationsDir}: the
 * `package.json` file is a sibling of `dist/` in production (post-
 * tsup install) and a sibling of `src/` in development. Both anchors
 * are tried in order; if neither yields a parseable JSON with a
 * `version` string field, the {@link UNKNOWN_PACKAGE_VERSION}
 * sentinel is returned so the bootstrap never blocks on a missing
 * package metadata file.
 */
export function resolvePackageVersion(): string {
  const candidates = collectFsCandidates((anchor) => [
    // Sibling of dist/ (production npm install layout).
    path.resolve(anchor, "..", "package.json"),
    // Sibling of src/ (dev / tsx layout — `code/src/bootstrap/`
    // → `code/package.json`).
    path.resolve(anchor, "..", "..", "package.json"),
  ]);

  for (const candidate of candidates) {
    const version = readPackageVersionField(candidate);
    if (version !== null) return version;
  }
  return UNKNOWN_PACKAGE_VERSION;
}

/**
 * The `name` field expected in the bundled `package.json`.
 * {@link readPackageVersionField} skips any candidate whose `name`
 * does not match this constant — without the guard, the resolver
 * would return the `version` of the first sibling `package.json`
 * it finds, including binaries like `vitest` whose `argv[1]`
 * anchors the search.
 */
const EXPECTED_PACKAGE_NAME = "@netzi/recall";

/**
 * Reads `version` from a candidate `package.json`. Returns `null`
 * if the file is missing, malformed JSON, lacks the right `name`
 * field, or the version field is absent / empty. Extracted from
 * {@link resolvePackageVersion} to keep its cognitive complexity
 * inside the Sonar S3776 limit (PR #37 round 2).
 */
function readPackageVersionField(candidate: string): string | null {
  let raw: string;
  try {
    raw = fs.readFileSync(candidate, "utf8");
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
  const name = (parsed as { readonly name?: unknown }).name;
  if (name !== EXPECTED_PACKAGE_NAME) return null;
  const version = (parsed as { readonly version?: unknown }).version;
  return typeof version === "string" && version.length > 0 ? version : null;
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
    // Read from `package.json` at boot rather than hardcoded — see
    // {@link resolvePackageVersion} for the rationale and the
    // failed-discipline incidents this avoids.
    version: resolvePackageVersion(),
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

  const mcpStdioMaxBufferBytes = resolveMcpStdioMaxBufferBytes();
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
    ...(mcpStdioMaxBufferBytes === null
      ? {}
      : { mcpStdioMaxBufferBytes }),
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
