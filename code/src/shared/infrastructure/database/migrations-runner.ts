import { promises as fs } from "node:fs";
import path from "node:path";

import type {
  DatabaseConnection,
  PreparedStatement,
} from "../../application/ports/database-connection.port.ts";
import type { Logger } from "../../application/ports/logger.port.ts";
import { DatabaseError } from "../errors/database-error.ts";

/**
 * Outcome of a single {@link MigrationsRunner.run} invocation.
 *
 * - `applied`  — versions newly applied during this run, in ascending
 *   order. Empty if the database was already at the latest version.
 * - `skipped`  — versions that were already present in
 *   `schema_migrations` and therefore not re-applied.
 * - `current`  — the highest version present in the database after the
 *   run completes (i.e. `max(applied ∪ skipped)`, or 0 when the
 *   database is empty AND no migrations exist on disk).
 */
export interface MigrationsResult {
  readonly applied: readonly number[];
  readonly skipped: readonly number[];
  readonly current: number;
}

interface MigrationFile {
  readonly version: number;
  readonly name: string;
  readonly absolutePath: string;
}

interface SchemaMigrationRow {
  readonly version: number;
  readonly name: string;
  readonly applied_at: number;
}

/**
 * Idempotent SQL migrations runner.
 *
 * Behaviour:
 * 1. Ensures the `schema_migrations(version, name, applied_at)` table
 *    exists.
 * 2. Lists every `<NNN>__<name>.sql` file inside `migrationsDir`,
 *    parses the leading integer as the version, and sorts them in
 *    ascending order.
 * 3. Loads `schema_migrations` into memory.
 * 4. **Refuses to start if the DB has a higher version than the code**
 *    (`DatabaseError.migrationAheadOfCode`). This is the canonical
 *    protection against a downgrade running on an upgraded DB.
 * 5. For each file whose version is NOT yet in `schema_migrations`:
 *    - Opens a transaction.
 *    - Executes the SQL via {@link DatabaseConnection.exec}.
 *    - INSERTs the `(version, name, applied_at_ms)` row.
 *    - Commits.
 *    On thrown exception the transaction rolls back atomically and the
 *    runner stops, surfacing
 *    {@link DatabaseError.migrationFailed} with the offending
 *    version.
 *
 * Why a runner class (instead of a free function):
 * - Receives the {@link Logger} via constructor injection so audit
 *   events (`migration.applied`, `migration.skipped`) are emitted under
 *   the same scoped child logger as the rest of the bootstrap.
 * - Lets the test suite swap a `RecordingLogger` to assert ordering.
 *
 * Why version is a number:
 * - The on-disk filename prefix is `NNN` (zero-padded to 3 digits in
 *   the convention, but the parser accepts any length). The numeric
 *   ordering is the canonical ordering — string ordering would break
 *   when crossing 999 → 1000.
 *
 * Idempotence guarantees:
 * - Re-running with the same files and DB is a no-op (everything
 *   ends up in `skipped`).
 * - `schema_migrations` is intentionally created OUTSIDE any user
 *   transaction so the bookkeeping table itself is migration-free.
 *
 * Composition root example:
 * ```typescript
 * const runner = new MigrationsRunner(logger);
 * const result = await runner.run(db, path.resolve("migrations"));
 * logger.info({ result }, "migrations completed");
 * ```
 */
export class MigrationsRunner {
  /**
   * Filename pattern: an integer prefix followed by `__` and a
   * descriptive name (kebab- or snake_case allowed) and the `.sql`
   * suffix.
   */
  private static readonly FILENAME_REGEX = /^(\d+)__([\w-]+)\.sql$/;

  public constructor(private readonly logger: Logger) {}

  /**
   * Applies all pending migrations and returns the outcome.
   */
  public async run(
    db: DatabaseConnection,
    migrationsDir: string,
  ): Promise<MigrationsResult> {
    this.ensureSchemaMigrationsTable(db);
    const files = await this.discoverMigrationFiles(migrationsDir);
    const present = this.loadSchemaMigrations(db);

    if (present.length > 0 && files.length > 0) {
      const dbMax = Math.max(...present.map((row) => row.version));
      const codeMax = Math.max(...files.map((m) => m.version));
      if (dbMax > codeMax) {
        throw DatabaseError.migrationAheadOfCode(dbMax, codeMax);
      }
    } else if (present.length > 0 && files.length === 0) {
      // DB has migrations but the code ships none — also "ahead of code"
      // semantically. Surfaced with the same error code.
      const dbMax = Math.max(...present.map((row) => row.version));
      throw DatabaseError.migrationAheadOfCode(dbMax, 0);
    }

    const presentVersions = new Set(present.map((row) => row.version));
    const applied: number[] = [];
    const skipped: number[] = [];

    for (const migration of files) {
      if (presentVersions.has(migration.version)) {
        skipped.push(migration.version);
        continue;
      }

      const sql = await this.readMigrationFile(migration);
      this.applyMigration(db, migration, sql);
      applied.push(migration.version);
      this.logger.info(
        { version: migration.version, name: migration.name },
        "migration applied",
      );
    }

    const current = this.computeCurrent(applied, skipped, present);
    return Object.freeze({
      applied: Object.freeze([...applied]),
      skipped: Object.freeze([...skipped]),
      current,
    });
  }

  private ensureSchemaMigrationsTable(db: DatabaseConnection): void {
    db.exec(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         version    INTEGER PRIMARY KEY,
         name       TEXT NOT NULL,
         applied_at INTEGER NOT NULL
       );`,
    );
  }

  private async discoverMigrationFiles(
    migrationsDir: string,
  ): Promise<readonly MigrationFile[]> {
    let entries: readonly string[];
    try {
      entries = await fs.readdir(migrationsDir);
    } catch (cause: unknown) {
      throw DatabaseError.migrationDirectoryInvalid(
        migrationsDir,
        `cannot read directory: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }

    const files: MigrationFile[] = [];
    const seenVersions = new Set<number>();
    for (const entry of entries) {
      const match = MigrationsRunner.FILENAME_REGEX.exec(entry);
      if (match === null) continue; // ignore README, .gitignore, etc.

      const versionStr = match[1];
      const name = match[2];
      if (versionStr === undefined || name === undefined) continue;

      const version = Number.parseInt(versionStr, 10);
      if (!Number.isFinite(version) || version < 0) continue;
      if (seenVersions.has(version)) {
        throw DatabaseError.migrationDirectoryInvalid(
          migrationsDir,
          `duplicate migration version ${String(version)} (${entry})`,
        );
      }
      seenVersions.add(version);
      files.push({
        version,
        name,
        absolutePath: path.join(migrationsDir, entry),
      });
    }

    files.sort((a, b) => a.version - b.version);
    return files;
  }

  private loadSchemaMigrations(
    db: DatabaseConnection,
  ): readonly SchemaMigrationRow[] {
    const stmt = db.prepare(
      "SELECT version, name, applied_at FROM schema_migrations ORDER BY version ASC",
    );
    const rows = stmt.all();
    return rows.map((row) => MigrationsRunner.parseRow(row));
  }

  private async readMigrationFile(
    migration: MigrationFile,
  ): Promise<string> {
    try {
      return await fs.readFile(migration.absolutePath, "utf8");
    } catch (cause: unknown) {
      throw DatabaseError.migrationFailed(
        migration.version,
        migration.name,
        cause,
      );
    }
  }

  private applyMigration(
    db: DatabaseConnection,
    migration: MigrationFile,
    sql: string,
  ): void {
    try {
      db.transaction((): void => {
        db.exec(sql);
        const insert: PreparedStatement = db.prepare(
          "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
        );
        insert.run(migration.version, migration.name, Date.now());
      });
    } catch (cause: unknown) {
      throw DatabaseError.migrationFailed(
        migration.version,
        migration.name,
        cause,
      );
    }
  }

  private computeCurrent(
    applied: readonly number[],
    skipped: readonly number[],
    present: readonly SchemaMigrationRow[],
  ): number {
    const allVersions: number[] = [
      ...applied,
      ...skipped,
      ...present.map((row) => row.version),
    ];
    if (allVersions.length === 0) return 0;
    return Math.max(...allVersions);
  }

  /**
   * Validates a `schema_migrations` row read back as `unknown`. The
   * port surface intentionally returns `unknown`; the runner is the
   * single place that knows the schema, so the parser lives here.
   */
  private static parseRow(row: unknown): SchemaMigrationRow {
    if (typeof row !== "object" || row === null) {
      throw DatabaseError.migrationDirectoryInvalid(
        "<schema_migrations>",
        "row is not an object",
      );
    }
    const candidate = row as Readonly<Record<string, unknown>>;
    const version = candidate["version"];
    const name = candidate["name"];
    const appliedAt = candidate["applied_at"];
    if (typeof version !== "number" || !Number.isInteger(version)) {
      throw DatabaseError.migrationDirectoryInvalid(
        "<schema_migrations>",
        "version column is not an integer",
      );
    }
    if (typeof name !== "string" || name.length === 0) {
      throw DatabaseError.migrationDirectoryInvalid(
        "<schema_migrations>",
        "name column is not a non-empty string",
      );
    }
    if (typeof appliedAt !== "number" || !Number.isInteger(appliedAt)) {
      throw DatabaseError.migrationDirectoryInvalid(
        "<schema_migrations>",
        "applied_at column is not an integer",
      );
    }
    return { version, name, applied_at: appliedAt };
  }
}
