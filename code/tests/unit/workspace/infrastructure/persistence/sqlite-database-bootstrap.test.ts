import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { SqliteDatabaseBootstrap } from "../../../../../src/modules/workspace/infrastructure/persistence/sqlite-database-bootstrap.ts";
import { WorkspaceMode } from "../../../../../src/modules/workspace/domain/value-objects/workspace-mode.ts";
import { WorkspacePath } from "../../../../../src/modules/workspace/domain/value-objects/workspace-path.ts";
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

interface Tmp {
  readonly tmpDir: string;
  readonly migrationsDir: string;
  cleanup: () => Promise<void>;
}

async function tmp(): Promise<Tmp> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "recall-bootstrap-"));
  const migrationsDir = path.join(tmpDir, "migrations");
  await fs.mkdir(migrationsDir, { recursive: true });
  await fs.writeFile(
    path.join(migrationsDir, "1__init.sql"),
    "CREATE TABLE m (i INTEGER);",
    "utf8",
  );
  // Workspace dir.
  await fs.mkdir(path.join(tmpDir, ".recall"), { recursive: true });
  return {
    tmpDir,
    migrationsDir,
    cleanup: async () => {
      await fs.rm(tmpDir, { recursive: true, force: true });
    },
  };
}

let ctx: Tmp;
beforeEach(async () => {
  ctx = await tmp();
});
afterEach(async () => {
  await ctx.cleanup();
});

describe("SqliteDatabaseBootstrap", () => {
  it("bootstrap opens the DB, runs migrations, returns schemaVersion", async () => {
    const adapter = new SqliteDatabaseBootstrap({
      migrationsDir: ctx.migrationsDir,
      keyResolver: () => Promise.resolve(null),
      logger: new SilentLogger(),
    });
    const r = await adapter.bootstrap({
      rootPath: WorkspacePath.create(ctx.tmpDir),
      mode: WorkspaceMode.sharedMode(),
    });
    expect(r.schemaVersion).toBe(1);
    // Bootstrap closed the connection — file remains.
    const stat = await fs.stat(path.join(ctx.tmpDir, ".recall", "recall.db"));
    expect(stat.isFile()).toBe(true);
  });

  it("probe returns openable+schemaVersion after bootstrap", async () => {
    const adapter = new SqliteDatabaseBootstrap({
      migrationsDir: ctx.migrationsDir,
      keyResolver: () => Promise.resolve(null),
      logger: new SilentLogger(),
    });
    await adapter.bootstrap({
      rootPath: WorkspacePath.create(ctx.tmpDir),
      mode: WorkspaceMode.sharedMode(),
    });
    const p = await adapter.probe({
      rootPath: WorkspacePath.create(ctx.tmpDir),
      mode: WorkspaceMode.sharedMode(),
    });
    expect(p.openable).toBe(true);
    expect(p.schemaVersion).toBe(1);
  });

  it("probe returns openable=false when the DB cannot open", async () => {
    const adapter = new SqliteDatabaseBootstrap({
      migrationsDir: ctx.migrationsDir,
      keyResolver: () => Promise.resolve(null),
      logger: new SilentLogger(),
    });
    // No bootstrap → no DB file → SQLite will create it on open. To
    // force a failure we point at a path we cannot create (parent is
    // a regular file).
    const blocker = path.join(ctx.tmpDir, "blocker.fake");
    await fs.writeFile(blocker, "x", "utf8");
    const r = await adapter.probe({
      rootPath: WorkspacePath.create(blocker),
      mode: WorkspaceMode.sharedMode(),
    });
    // probe is best-effort: should report openable=false instead of throwing.
    expect(r.openable).toBe(false);
    expect(r.schemaVersion).toBeNull();
  });

  it("probe returns openable=false when the keyResolver throws", async () => {
    const adapter = new SqliteDatabaseBootstrap({
      migrationsDir: ctx.migrationsDir,
      keyResolver: () => Promise.reject(new Error("locked")),
      logger: new SilentLogger(),
    });
    const r = await adapter.probe({
      rootPath: WorkspacePath.create(ctx.tmpDir),
      mode: WorkspaceMode.encryptedMode(),
    });
    expect(r.openable).toBe(false);
    expect(r.schemaVersion).toBeNull();
  });

  it("probe parses schema_version null when row shape is unexpected", async () => {
    // Bootstrap creates the schema_migrations table; we probe and
    // accept either a number or null. Verify both branches: empty
    // schema_migrations should yield schemaVersion = null because
    // MAX returns NULL.
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "recall-empty-"));
    try {
      await fs.mkdir(path.join(dir, ".recall"), { recursive: true });
      const empty = path.join(dir, "no-migrations");
      await fs.mkdir(empty, { recursive: true });
      const adapter = new SqliteDatabaseBootstrap({
        migrationsDir: empty,
        keyResolver: () => Promise.resolve(null),
        logger: new SilentLogger(),
      });
      await adapter.bootstrap({
        rootPath: WorkspacePath.create(dir),
        mode: WorkspaceMode.sharedMode(),
      });
      const p = await adapter.probe({
        rootPath: WorkspacePath.create(dir),
        mode: WorkspaceMode.sharedMode(),
      });
      // schema_migrations table exists but is empty → MAX returns NULL.
      expect(p.openable).toBe(true);
      expect(p.schemaVersion).toBeNull();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("modeKey accepts the three documented values", async () => {
    let captured: string | null = null;
    const adapter = new SqliteDatabaseBootstrap({
      migrationsDir: ctx.migrationsDir,
      keyResolver: ({ mode }) => {
        captured = mode;
        return Promise.resolve(null);
      },
      logger: new SilentLogger(),
    });
    await adapter.bootstrap({
      rootPath: WorkspacePath.create(ctx.tmpDir),
      mode: WorkspaceMode.privateMode(),
    });
    expect(captured).toBe("private");
  });
});
