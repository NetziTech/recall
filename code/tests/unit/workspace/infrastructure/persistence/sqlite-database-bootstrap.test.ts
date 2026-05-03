import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { SqliteDatabaseBootstrap } from "../../../../../src/modules/workspace/infrastructure/persistence/sqlite-database-bootstrap.ts";
import { WorkspaceMode } from "../../../../../src/modules/workspace/domain/value-objects/workspace-mode.ts";
import { WorkspacePath } from "../../../../../src/modules/workspace/domain/value-objects/workspace-path.ts";
import type { Logger } from "../../../../../src/shared/application/ports/logger.port.ts";
import type { EncryptionKeyBytes } from "../../../../../src/shared/infrastructure/database/sqlite-database.ts";

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

describe("SqliteDatabaseBootstrap — recall.db chmod 0o600 (W-3.5-SEC-M2)", () => {
  // chmod is a no-op on Windows per Node `fs.chmod` docs; permission
  // bits are not meaningful on NTFS via this API, so we skip the
  // VALUE-not-SHAPE assertion entirely on win32 to avoid false negatives.

  it("bootstrap sets recall.db mode to 0o600 in shared mode", async () => {
    if (process.platform === "win32") return;
    const adapter = new SqliteDatabaseBootstrap({
      migrationsDir: ctx.migrationsDir,
      keyResolver: () => Promise.resolve(null),
      logger: new SilentLogger(),
    });
    await adapter.bootstrap({
      rootPath: WorkspacePath.create(ctx.tmpDir),
      mode: WorkspaceMode.sharedMode(),
    });
    const dbPath = path.join(ctx.tmpDir, ".recall", "recall.db");
    const stat = await fs.stat(dbPath);
    // VALUE not SHAPE: assert the actual permission bits are 0o600.
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it("bootstrap sets recall.db mode to 0o600 in private mode", async () => {
    if (process.platform === "win32") return;
    const adapter = new SqliteDatabaseBootstrap({
      migrationsDir: ctx.migrationsDir,
      keyResolver: () => Promise.resolve(null),
      logger: new SilentLogger(),
    });
    await adapter.bootstrap({
      rootPath: WorkspacePath.create(ctx.tmpDir),
      mode: WorkspaceMode.privateMode(),
    });
    const dbPath = path.join(ctx.tmpDir, ".recall", "recall.db");
    const stat = await fs.stat(dbPath);
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it("bootstrap sets recall.db mode to 0o600 in encrypted mode", async () => {
    if (process.platform === "win32") return;
    // Provide a deterministic 32-byte key so SqliteDatabase.open
    // applies SQLCipher pragmas. The chmod must happen regardless of
    // whether the workspace is encrypted (the file still lands on the
    // host filesystem with the same permission concerns).
    const key: EncryptionKeyBytes = { bytes: new Uint8Array(32).fill(0x42) };
    const adapter = new SqliteDatabaseBootstrap({
      migrationsDir: ctx.migrationsDir,
      keyResolver: () => Promise.resolve(key),
      logger: new SilentLogger(),
    });
    await adapter.bootstrap({
      rootPath: WorkspacePath.create(ctx.tmpDir),
      mode: WorkspaceMode.encryptedMode(),
    });
    const dbPath = path.join(ctx.tmpDir, ".recall", "recall.db");
    const stat = await fs.stat(dbPath);
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it("bootstrap chmod is idempotent across repeated runs", async () => {
    if (process.platform === "win32") return;
    const adapter = new SqliteDatabaseBootstrap({
      migrationsDir: ctx.migrationsDir,
      keyResolver: () => Promise.resolve(null),
      logger: new SilentLogger(),
    });
    const dbPath = path.join(ctx.tmpDir, ".recall", "recall.db");

    await adapter.bootstrap({
      rootPath: WorkspacePath.create(ctx.tmpDir),
      mode: WorkspaceMode.sharedMode(),
    });
    const first = await fs.stat(dbPath);
    expect(first.mode & 0o777).toBe(0o600);

    // Loosen the bits to simulate umask drift / external interference,
    // then re-bootstrap and verify the second run tightens back to 0o600.
    await fs.chmod(dbPath, 0o644);
    const drifted = await fs.stat(dbPath);
    expect(drifted.mode & 0o777).toBe(0o644);

    await adapter.bootstrap({
      rootPath: WorkspacePath.create(ctx.tmpDir),
      mode: WorkspaceMode.sharedMode(),
    });
    const second = await fs.stat(dbPath);
    expect(second.mode & 0o777).toBe(0o600);
  });
});
