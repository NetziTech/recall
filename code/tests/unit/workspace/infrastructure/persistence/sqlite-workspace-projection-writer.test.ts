/**
 * Tests for `SqliteWorkspaceProjectionWriter`.
 *
 * The adapter opens its own short-lived SQLite handle per upsert, so
 * we can exercise it end-to-end against a temp database. The
 * keyResolver throwing path is covered by a closure that rejects.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { SqliteWorkspaceProjectionWriter } from "../../../../../src/modules/workspace/infrastructure/persistence/sqlite-workspace-projection-writer.ts";
import { WorkspacePath } from "../../../../../src/modules/workspace/domain/value-objects/workspace-path.ts";
import { WorkspaceConfig } from "../../../../../src/modules/workspace/domain/value-objects/workspace-config.ts";
import { WorkspaceMode } from "../../../../../src/modules/workspace/domain/value-objects/workspace-mode.ts";
import { DisplayName } from "../../../../../src/modules/workspace/domain/value-objects/display-name.ts";
import { EmbedderSpec } from "../../../../../src/modules/workspace/domain/value-objects/embedder-spec.ts";
import { WorkspaceInfrastructureError } from "../../../../../src/modules/workspace/infrastructure/errors/workspace-infrastructure-error.ts";
import { WorkspaceId } from "../../../../../src/shared/domain/value-objects/workspace-id.ts";
import { Timestamp } from "../../../../../src/shared/domain/value-objects/timestamp.ts";
import { SqliteDatabase } from "../../../../../src/shared/infrastructure/database/sqlite-database.ts";
import { MigrationsRunner } from "../../../../../src/shared/infrastructure/database/migrations-runner.ts";
import { RecordingLogger } from "../../../../_fixtures/silent-logger.ts";

import { FIXED_WORKSPACE_UUID, ANCHOR_TIME_MS } from "../../../../helpers/factories.ts";

const fileurl = (p: string): string => p; // hint for ts editors only

const MIGRATIONS_DIR = path.resolve(
  // tests/ -> code/, then migrations
  fileurl(import.meta.dirname),
  "..",
  "..",
  "..",
  "..",
  "..",
  "migrations",
);

let tmpDir: string;
let workspaceRoot: WorkspacePath;
let logger: RecordingLogger;

const sampleConfig = (): WorkspaceConfig =>
  WorkspaceConfig.create({
    schemaVersion: "1.0.0",
    workspaceId: WorkspaceId.from(FIXED_WORKSPACE_UUID),
    displayName: DisplayName.create("Test Workspace"),
    mode: WorkspaceMode.sharedMode(),
    embedder: EmbedderSpec.create({
      provider: "fastembed",
      model: "BGESmallEN15",
      dim: 384,
    }),
    createdAt: Timestamp.fromEpochMs(ANCHOR_TIME_MS),
  });

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-projwriter-"));
  workspaceRoot = WorkspacePath.create(tmpDir);
  logger = new RecordingLogger();
  // Pre-create the workspace directory and run migrations so the
  // adapter's short-lived handle finds a populated DB.
  await fs.mkdir(path.join(tmpDir, ".mcp-memoria"), { recursive: true });
  const dbPath = path.join(tmpDir, ".mcp-memoria", "memoria.db");
  const db = await SqliteDatabase.open({
    path: dbPath,
    loadVectorExtension: true,
    logger,
  });
  try {
    const runner = new MigrationsRunner(logger);
    await runner.run(db, MIGRATIONS_DIR);
  } finally {
    db.close();
  }
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
});

describe("SqliteWorkspaceProjectionWriter.upsert — happy paths", () => {
  it("inserts the row when no prior row exists", async () => {
    const writer = new SqliteWorkspaceProjectionWriter({
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- shared mode → null key
      keyResolver: async (_input) => null,
      logger,
    });
    await writer.upsert({
      rootPath: workspaceRoot,
      config: sampleConfig(),
      updatedAtMs: ANCHOR_TIME_MS + 1,
    });
    // Re-open to read what the adapter wrote.
    const dbPath = path.join(tmpDir, ".mcp-memoria", "memoria.db");
    const db = await SqliteDatabase.open({
      path: dbPath,
      loadVectorExtension: true,
      logger,
    });
    try {
      const stmt = db.prepare(
        `SELECT workspace_id, display_name, mode, updated_at_ms FROM workspace_config WHERE workspace_id = ?`,
      );
      const row = stmt.get(FIXED_WORKSPACE_UUID) as {
        workspace_id: string;
        display_name: string;
        mode: string;
        updated_at_ms: number;
      };
      expect(row.workspace_id).toBe(FIXED_WORKSPACE_UUID);
      expect(row.display_name).toBe("Test Workspace");
      expect(row.mode).toBe("shared");
      expect(row.updated_at_ms).toBe(ANCHOR_TIME_MS + 1);
    } finally {
      db.close();
    }
  });

  it("upsert is idempotent — second call updates", async () => {
    const writer = new SqliteWorkspaceProjectionWriter({
      keyResolver: async () => null,
      logger,
    });
    await writer.upsert({
      rootPath: workspaceRoot,
      config: sampleConfig(),
      updatedAtMs: ANCHOR_TIME_MS + 1,
    });
    await writer.upsert({
      rootPath: workspaceRoot,
      config: sampleConfig(),
      updatedAtMs: ANCHOR_TIME_MS + 100,
    });
    const dbPath = path.join(tmpDir, ".mcp-memoria", "memoria.db");
    const db = await SqliteDatabase.open({
      path: dbPath,
      loadVectorExtension: true,
      logger,
    });
    try {
      const stmt = db.prepare(
        `SELECT updated_at_ms FROM workspace_config WHERE workspace_id = ?`,
      );
      const row = stmt.get(FIXED_WORKSPACE_UUID) as { updated_at_ms: number };
      expect(row.updated_at_ms).toBe(ANCHOR_TIME_MS + 100);
    } finally {
      db.close();
    }
  });

  it("works with mode='private' (alternative branch in modeKey)", async () => {
    const writer = new SqliteWorkspaceProjectionWriter({
      keyResolver: async () => null,
      logger,
    });
    const cfg = WorkspaceConfig.create({
      schemaVersion: "1.0.0",
      workspaceId: WorkspaceId.from(FIXED_WORKSPACE_UUID),
      displayName: DisplayName.create("Priv"),
      mode: WorkspaceMode.privateMode(),
      embedder: EmbedderSpec.create({
        provider: "fastembed",
        model: "BGESmallEN15",
        dim: 384,
      }),
      createdAt: Timestamp.fromEpochMs(ANCHOR_TIME_MS),
    });
    await writer.upsert({
      rootPath: workspaceRoot,
      config: cfg,
      updatedAtMs: ANCHOR_TIME_MS + 1,
    });
  });
});

describe("SqliteWorkspaceProjectionWriter.upsert — failure paths", () => {
  it("wraps a keyResolver throw into configWriteFailed", async () => {
    const writer = new SqliteWorkspaceProjectionWriter({
      keyResolver: async () => {
        throw new Error("resolver crashed");
      },
      logger,
    });
    const e = await writer
      .upsert({
        rootPath: workspaceRoot,
        config: sampleConfig(),
        updatedAtMs: ANCHOR_TIME_MS + 1,
      })
      .then(
        () => null,
        (err: unknown) => err,
      );
    expect(e).toBeInstanceOf(WorkspaceInfrastructureError);
    expect((e as WorkspaceInfrastructureError).code).toBe(
      "workspace.config-write-failed",
    );
  });

  it("wraps an open/exec failure into configWriteFailed", async () => {
    // Simulate by passing a workspace path whose DB cannot be opened —
    // we wipe the workspace dir first so the SQLite open against
    // `<root>/.mcp-memoria/memoria.db` fails (the parent directory
    // does not exist after rm).
    await fs.rm(path.join(tmpDir, ".mcp-memoria"), { recursive: true });
    const writer = new SqliteWorkspaceProjectionWriter({
      keyResolver: async () => null,
      logger,
    });
    const e = await writer
      .upsert({
        rootPath: workspaceRoot,
        config: sampleConfig(),
        updatedAtMs: ANCHOR_TIME_MS + 1,
      })
      .then(
        () => null,
        (err: unknown) => err,
      );
    expect(e).toBeInstanceOf(WorkspaceInfrastructureError);
    expect((e as WorkspaceInfrastructureError).code).toBe(
      "workspace.config-write-failed",
    );
  });
});
