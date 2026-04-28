import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { MigrationsRunner } from "../../../../../src/shared/infrastructure/database/migrations-runner.ts";
import { SqliteDatabase } from "../../../../../src/shared/infrastructure/database/sqlite-database.ts";
import { DatabaseError } from "../../../../../src/shared/infrastructure/errors/database-error.ts";
import type { Logger } from "../../../../../src/shared/application/ports/logger.port.ts";

class SilentLogger implements Logger {
  public trace(): void {}
  public debug(): void {}
  public info(): void {}
  public warn(): void {}
  public error(): void {}
  public fatal(): void {}
  public child(): Logger {
    return this;
  }
}

class RecordingLogger extends SilentLogger {
  public readonly entries: Array<{ readonly level: string; readonly payload: unknown }> = [];
  public override info(payload: unknown): void {
    this.entries.push({ level: "info", payload });
  }
}

interface Ctx {
  readonly tmpDir: string;
  readonly migrationsDir: string;
  cleanup: () => Promise<void>;
}

async function makeCtx(): Promise<Ctx> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "recall-migrations-"));
  const migrationsDir = path.join(tmpDir, "migrations");
  await fs.mkdir(migrationsDir, { recursive: true });
  return {
    tmpDir,
    migrationsDir,
    cleanup: async () => {
      await fs.rm(tmpDir, { recursive: true, force: true });
    },
  };
}

async function writeMigration(
  ctx: Ctx,
  filename: string,
  sql: string,
): Promise<void> {
  await fs.writeFile(path.join(ctx.migrationsDir, filename), sql, "utf8");
}

async function newDb(): Promise<SqliteDatabase> {
  return await SqliteDatabase.open({
    path: ":memory:",
    logger: new SilentLogger(),
    loadVectorExtension: false,
  });
}

describe("MigrationsRunner.run", () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await makeCtx();
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it("creates schema_migrations table on first run", async () => {
    const runner = new MigrationsRunner(new SilentLogger());
    const db = await newDb();
    try {
      await runner.run(db, ctx.migrationsDir);
      const stmt = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'",
      );
      expect(stmt.get()).toEqual({ name: "schema_migrations" });
    } finally {
      db.close();
    }
  });

  it("returns current=0 when DB and dir are empty", async () => {
    const runner = new MigrationsRunner(new SilentLogger());
    const db = await newDb();
    try {
      const r = await runner.run(db, ctx.migrationsDir);
      expect(r.applied).toEqual([]);
      expect(r.skipped).toEqual([]);
      expect(r.current).toBe(0);
    } finally {
      db.close();
    }
  });

  it("applies migrations in numerical order, not lexical", async () => {
    // 9 should come BEFORE 10 (but lexically "10" < "9").
    await writeMigration(ctx, "9__nine.sql", "CREATE TABLE m9 (i INTEGER);");
    await writeMigration(ctx, "10__ten.sql", "CREATE TABLE m10 (i INTEGER);");
    await writeMigration(ctx, "1__one.sql", "CREATE TABLE m1 (i INTEGER);");

    const logger = new RecordingLogger();
    const runner = new MigrationsRunner(logger);
    const db = await newDb();
    try {
      const r = await runner.run(db, ctx.migrationsDir);
      expect(r.applied).toEqual([1, 9, 10]);
      expect(r.current).toBe(10);
      // schema_migrations rows in order:
      const rows = db
        .prepare(
          "SELECT version, name FROM schema_migrations ORDER BY version ASC",
        )
        .all();
      expect(rows).toEqual([
        { version: 1, name: "one" },
        { version: 9, name: "nine" },
        { version: 10, name: "ten" },
      ]);
    } finally {
      db.close();
    }
  });

  it("is idempotent: re-running with same files reports skipped", async () => {
    await writeMigration(ctx, "1__a.sql", "CREATE TABLE a (id INTEGER);");
    const runner = new MigrationsRunner(new SilentLogger());
    const db = await newDb();
    try {
      const r1 = await runner.run(db, ctx.migrationsDir);
      expect(r1.applied).toEqual([1]);
      const r2 = await runner.run(db, ctx.migrationsDir);
      expect(r2.applied).toEqual([]);
      expect(r2.skipped).toEqual([1]);
      expect(r2.current).toBe(1);
    } finally {
      db.close();
    }
  });

  it("ignores non-matching filenames (README, .gitignore, ...)", async () => {
    await writeMigration(ctx, "README.md", "# hi");
    await writeMigration(ctx, "1__ok.sql", "CREATE TABLE t1 (i INTEGER);");
    await writeMigration(ctx, "weird-name.sql", "INVALID SQL;");
    const runner = new MigrationsRunner(new SilentLogger());
    const db = await newDb();
    try {
      const r = await runner.run(db, ctx.migrationsDir);
      expect(r.applied).toEqual([1]);
      expect(r.current).toBe(1);
    } finally {
      db.close();
    }
  });

  it("rejects duplicate version numbers in the directory", async () => {
    await writeMigration(ctx, "1__a.sql", "CREATE TABLE a (i INTEGER);");
    await writeMigration(ctx, "1__b.sql", "CREATE TABLE b (i INTEGER);");
    const runner = new MigrationsRunner(new SilentLogger());
    const db = await newDb();
    try {
      await expect(runner.run(db, ctx.migrationsDir)).rejects.toMatchObject({
        code: "database.migration-directory-invalid",
      });
    } finally {
      db.close();
    }
  });

  it("fails when a migration's SQL is invalid (rolls back, no insert in schema_migrations)", async () => {
    await writeMigration(ctx, "1__bad.sql", "THIS IS NOT SQL;");
    const runner = new MigrationsRunner(new SilentLogger());
    const db = await newDb();
    try {
      try {
        await runner.run(db, ctx.migrationsDir);
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(DatabaseError);
        expect((err as DatabaseError).code).toBe("database.migration-failed");
      }
      // schema_migrations was created (idempotent step) but no row was
      // inserted for the failing migration.
      const stmt = db.prepare(
        "SELECT COUNT(*) AS n FROM schema_migrations",
      );
      expect(stmt.get()).toEqual({ n: 0 });
    } finally {
      db.close();
    }
  });

  it("refuses to start when the DB is ahead of the code (downgrade guard)", async () => {
    // Pre-seed schema_migrations with version 5.
    const db = await newDb();
    try {
      db.exec(
        "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL); INSERT INTO schema_migrations (version, name, applied_at) VALUES (5, 'old', 0);",
      );
      // Code only ships up to version 1.
      await writeMigration(ctx, "1__a.sql", "CREATE TABLE a (i INTEGER);");
      const runner = new MigrationsRunner(new SilentLogger());
      await expect(runner.run(db, ctx.migrationsDir)).rejects.toMatchObject({
        code: "database.migration-ahead-of-code",
      });
    } finally {
      db.close();
    }
  });

  it("refuses to start when DB has migrations but code ships none", async () => {
    const db = await newDb();
    try {
      db.exec(
        "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL); INSERT INTO schema_migrations (version, name, applied_at) VALUES (3, 'old', 0);",
      );
      const runner = new MigrationsRunner(new SilentLogger());
      await expect(runner.run(db, ctx.migrationsDir)).rejects.toMatchObject({
        code: "database.migration-ahead-of-code",
      });
    } finally {
      db.close();
    }
  });

  it("rejects an unreadable migrations directory (ENOENT)", async () => {
    const runner = new MigrationsRunner(new SilentLogger());
    const db = await newDb();
    try {
      await expect(
        runner.run(db, "/this-path-does-not-exist-recall-test"),
      ).rejects.toMatchObject({
        code: "database.migration-directory-invalid",
      });
    } finally {
      db.close();
    }
  });

  it("ignores filenames whose numeric prefix is malformed", async () => {
    // Filename matches the regex but parses to NaN/negative? The regex
    // forces (\d+) so NaN is impossible. Make sure plain noise does
    // nothing and the runner still completes.
    await writeMigration(ctx, "noise.txt", "");
    await writeMigration(ctx, "0__zero.sql", "CREATE TABLE zero (i INTEGER);");
    const runner = new MigrationsRunner(new SilentLogger());
    const db = await newDb();
    try {
      const r = await runner.run(db, ctx.migrationsDir);
      expect(r.applied).toEqual([0]);
    } finally {
      db.close();
    }
  });

  it("emits an info log line per applied migration", async () => {
    await writeMigration(ctx, "1__a.sql", "CREATE TABLE a (i INTEGER);");
    await writeMigration(ctx, "2__b.sql", "CREATE TABLE b (i INTEGER);");
    const logger = new RecordingLogger();
    const runner = new MigrationsRunner(logger);
    const db = await newDb();
    try {
      await runner.run(db, ctx.migrationsDir);
      const infos = logger.entries.filter((e) => e.level === "info");
      expect(infos.length).toBe(2);
    } finally {
      db.close();
    }
  });

  it("rejects a row with non-integer version", async () => {
    const db = await newDb();
    try {
      db.exec(
        "CREATE TABLE schema_migrations (version, name TEXT, applied_at INTEGER); INSERT INTO schema_migrations (version, name, applied_at) VALUES ('not-a-number', 'x', 1);",
      );
      const runner = new MigrationsRunner(new SilentLogger());
      await expect(runner.run(db, ctx.migrationsDir)).rejects.toMatchObject({
        code: "database.migration-directory-invalid",
      });
    } finally {
      db.close();
    }
  });

  it("rejects a row with empty name", async () => {
    const db = await newDb();
    try {
      db.exec(
        "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT, applied_at INTEGER); INSERT INTO schema_migrations (version, name, applied_at) VALUES (1, '', 1);",
      );
      const runner = new MigrationsRunner(new SilentLogger());
      await expect(runner.run(db, ctx.migrationsDir)).rejects.toMatchObject({
        code: "database.migration-directory-invalid",
      });
    } finally {
      db.close();
    }
  });

  it("rejects a row with non-integer applied_at", async () => {
    const db = await newDb();
    try {
      db.exec(
        "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT, applied_at); INSERT INTO schema_migrations (version, name, applied_at) VALUES (1, 'x', 'not-an-int');",
      );
      const runner = new MigrationsRunner(new SilentLogger());
      await expect(runner.run(db, ctx.migrationsDir)).rejects.toMatchObject({
        code: "database.migration-directory-invalid",
      });
    } finally {
      db.close();
    }
  });

  it("works with the project's 000__bootstrap.sql in isolation", async () => {
    // The full project migrations dir needs sqlite-vec for migration 002;
    // we verify only the bootstrap migration in this unit suite to keep
    // the runner test focused on the runner behaviour. End-to-end
    // migration runs against the real schema are covered by the
    // SqliteDatabaseBootstrap integration test below.
    const projectMigrations = path.resolve(
      new URL("../../../../../migrations", import.meta.url).pathname,
    );
    const stats = await fs.stat(projectMigrations).catch(() => null);
    if (stats === null || !stats.isDirectory()) return;
    // Stage just the bootstrap migration into a fresh tmp dir.
    const isolated = await fs.mkdtemp(
      path.join(os.tmpdir(), "recall-bootstrap-only-"),
    );
    try {
      const src = path.join(projectMigrations, "000__bootstrap.sql");
      const dst = path.join(isolated, "000__bootstrap.sql");
      await fs.copyFile(src, dst);
      const logger = new SilentLogger();
      const runner = new MigrationsRunner(logger);
      const db = await newDb();
      try {
        const r = await runner.run(db, isolated);
        expect(r.applied).toEqual([0]);
        expect(r.current).toBe(0);
      } finally {
        db.close();
      }
    } finally {
      await fs.rm(isolated, { recursive: true, force: true });
    }
  });
});
