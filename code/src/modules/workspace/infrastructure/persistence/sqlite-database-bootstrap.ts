import * as path from "node:path";

import type { Logger } from "../../../../shared/application/ports/logger.port.ts";
import {
  MigrationsRunner,
  type MigrationsResult,
} from "../../../../shared/infrastructure/database/migrations-runner.ts";
import {
  SqliteDatabase,
  type EncryptionKeyBytes,
} from "../../../../shared/infrastructure/database/sqlite-database.ts";
import type {
  DatabaseBootstrap,
  DatabaseBootstrapInput,
  DatabaseBootstrapResult,
  DatabaseProbeResult,
} from "../../application/ports/out/database-bootstrap.port.ts";

/**
 * Adapter that bootstraps and probes the workspace's SQLite
 * database, implementing {@link DatabaseBootstrap}.
 *
 * The composition root supplies:
 *   - `migrationsDir`: the absolute path to the bundled migrations
 *     (the `code/migrations/` directory in this repo).
 *   - `keyResolver`: an async function the adapter calls only when
 *     the workspace mode is `encrypted`. The resolver wraps the
 *     encryption module's "give me the unlocked master key for this
 *     workspace" lookup. We do NOT inject the key directly because
 *     keys MUST be fetched on demand and never cached on the
 *     adapter (see `docs/11-seguridad-modos.md` §7).
 *
 * The adapter never writes encrypted-mode key material to logs.
 *
 * Probe contract:
 *   - `probe` opens read-only, reads the schema_version from
 *     `_meta`, and closes immediately. It does NOT load
 *     `sqlite-vec` (the bootstrap path does, but the probe is
 *     deliberately minimal so a missing extension does not turn a
 *     health check into a failure).
 */
export interface SqliteDatabaseBootstrapOptions {
  /** Absolute path to the bundled migrations directory. */
  readonly migrationsDir: string;
  /**
   * Lazy resolver for the encryption key when the workspace is in
   * `encrypted` mode. Must return `null` when the workspace is
   * either non-encrypted or currently locked.
   */
  readonly keyResolver: (input: {
    readonly mode: "shared" | "encrypted" | "private";
    readonly databasePath: string;
  }) => Promise<EncryptionKeyBytes | null>;
  /** Workspace logger. */
  readonly logger: Logger;
}

export class SqliteDatabaseBootstrap implements DatabaseBootstrap {
  public constructor(private readonly options: SqliteDatabaseBootstrapOptions) {}

  public async bootstrap(
    input: DatabaseBootstrapInput,
  ): Promise<DatabaseBootstrapResult> {
    const databasePath = SqliteDatabaseBootstrap.databasePath(input.rootPath.toString());
    const key = await this.options.keyResolver({
      mode: SqliteDatabaseBootstrap.modeKey(input.mode.toString()),
      databasePath,
    });

    const db = await SqliteDatabase.open({
      path: databasePath,
      encryptionKey: key ?? undefined,
      logger: this.options.logger,
    });
    try {
      const runner = new MigrationsRunner(this.options.logger);
      const result: MigrationsResult = await runner.run(
        db,
        this.options.migrationsDir,
      );
      this.options.logger.info(
        {
          databasePath,
          applied: result.applied.length,
          skipped: result.skipped.length,
          schemaVersion: result.current,
        },
        "workspace database bootstrapped",
      );
      return { schemaVersion: result.current };
    } finally {
      db.close();
    }
  }

  public async probe(
    input: DatabaseBootstrapInput,
  ): Promise<DatabaseProbeResult> {
    const databasePath = SqliteDatabaseBootstrap.databasePath(input.rootPath.toString());
    let key: EncryptionKeyBytes | null = null;
    try {
      key = await this.options.keyResolver({
        mode: SqliteDatabaseBootstrap.modeKey(input.mode.toString()),
        databasePath,
      });
    } catch (err: unknown) {
      this.options.logger.warn(
        {
          err: err instanceof Error ? err.message : String(err),
        },
        "key resolver failed during database probe; treating as locked",
      );
      return { openable: false, schemaVersion: null };
    }

    let db: SqliteDatabase | null = null;
    try {
      db = await SqliteDatabase.open({
        path: databasePath,
        encryptionKey: key ?? undefined,
        readonly: true,
        loadVectorExtension: false,
        logger: this.options.logger,
      });
      const stmt = db.prepare(
        "SELECT MAX(version) AS v FROM schema_migrations",
      );
      const row: unknown = stmt.get();
      const version = SqliteDatabaseBootstrap.parseSchemaVersion(row);
      return { openable: true, schemaVersion: version };
    } catch (err: unknown) {
      this.options.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "database probe failed",
      );
      return { openable: false, schemaVersion: null };
    } finally {
      if (db !== null) db.close();
    }
  }

  private static databasePath(rootPath: string): string {
    return path.resolve(path.join(rootPath, ".mcp-memoria", "memoria.db"));
  }

  private static modeKey(raw: string): "shared" | "encrypted" | "private" {
    if (raw === "shared") return "shared";
    if (raw === "encrypted") return "encrypted";
    return "private";
  }

  private static parseSchemaVersion(row: unknown): number | null {
    if (typeof row !== "object" || row === null) return null;
    const candidate = row as { readonly v?: unknown };
    const v = candidate.v;
    if (typeof v === "number" && Number.isInteger(v)) return v;
    return null;
  }
}
