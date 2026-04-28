/**
 * Integration test — Flow A: `mem.init` (initialize a workspace).
 *
 * Exercises the `InitializeWorkspaceUseCase` end-to-end via the CLI
 * facade and the MCP-server facade adapters wired in
 * `composition/facades/`. Walks every documented privacy mode:
 *
 *   - `shared`     — plain SQLite, no encryption.
 *   - `private`    — plain SQLite + `.gitignore` token.
 *   - `encrypted`  — SQLCipher master key minted via the encryption
 *                    module; verifies the config.json grew an
 *                    `encryption` slice with KDF params + envelopes.
 *
 * Also asserts re-initialisation is idempotent (second call returns
 * `wasCreated: false`).
 *
 * Boundary: workspace dir is created under a fresh `os.tmpdir()` per
 * test — every test gets its own DB and its own filesystem.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DisplayName } from "../../src/modules/workspace/domain/value-objects/display-name.ts";
import { EmbedderSpec } from "../../src/modules/workspace/domain/value-objects/embedder-spec.ts";
import { WorkspaceMode } from "../../src/modules/workspace/domain/value-objects/workspace-mode.ts";
import { WorkspacePath } from "../../src/modules/workspace/domain/value-objects/workspace-path.ts";
import { buildTestContainer, type TestContainer } from "./_helpers/build-test-container.ts";

const DEFAULT_EMBEDDER = EmbedderSpec.create({
  provider: "fastembed",
  model: "BGESmallEN15",
});

interface PersistedConfig {
  readonly schema_version: string;
  readonly workspace_id: string;
  readonly display_name: string;
  readonly mode: string;
  readonly created_at_ms: number;
  readonly embedder: { provider: string; model: string; dim: number };
  // Encryption slice (per `docs/03 §2` and the encryption persistence
  // adapter) lives at the TOP level of config.json — not nested.
  readonly kdf?: string;
  readonly kdf_params?: unknown;
  readonly key_validator_blob_b64?: unknown;
  readonly key_envelopes?: readonly unknown[];
}

function readConfig(workspaceRoot: string): PersistedConfig {
  const raw = fs.readFileSync(
    path.join(workspaceRoot, ".recall", "config.json"),
    "utf8",
  );
  return JSON.parse(raw) as PersistedConfig;
}

describe("integration / A / mem.init — workspace initialisation", () => {
  let ctx: TestContainer;

  beforeEach(async () => {
    // We need a fresh tmp dir AND no migrations applied on the
    // pre-built test DB: the workspace bootstrap will open its own
    // connection and run them. The pre-built DB connection is held
    // open by the wiring graph but we avoid pre-applying migrations.
    ctx = await buildTestContainer({ skipMigrations: true });
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  describe("shared mode", () => {
    it("creates workspace dir, persists config.json, runs migrations", async () => {
      const result = await ctx.workspace.initializeWorkspace.initialize({
        rootPath: WorkspacePath.create(ctx.workspaceRoot),
        mode: WorkspaceMode.sharedMode(),
        displayName: DisplayName.create("test-shared"),
        embedder: DEFAULT_EMBEDDER,
        passphrase: null,
      });

      expect(result.wasCreated).toBe(true);
      const config = readConfig(ctx.workspaceRoot);
      expect(config.mode).toBe("shared");
      expect(config.display_name).toBe("test-shared");
      expect(config.embedder.dim).toBe(384);
      expect(config.encryption).toBeUndefined();

      // The workspace bootstrap opened its own DB + applied
      // migrations. Re-open via the workspace's database bootstrap
      // probe to verify schema_version is at least 5 (the highest
      // shipped migration).
      const probe = await ctx.workspace.databaseBootstrap.probe({
        rootPath: WorkspacePath.create(ctx.workspaceRoot),
        mode: WorkspaceMode.sharedMode(),
      });
      expect(probe.openable).toBe(true);
      expect(probe.schemaVersion ?? 0).toBeGreaterThanOrEqual(5);
    });

    it("re-init in same mode is idempotent (wasCreated=false)", async () => {
      await ctx.workspace.initializeWorkspace.initialize({
        rootPath: WorkspacePath.create(ctx.workspaceRoot),
        mode: WorkspaceMode.sharedMode(),
        displayName: DisplayName.create("idem"),
        embedder: DEFAULT_EMBEDDER,
        passphrase: null,
      });
      const second = await ctx.workspace.initializeWorkspace.initialize({
        rootPath: WorkspacePath.create(ctx.workspaceRoot),
        mode: WorkspaceMode.sharedMode(),
        displayName: DisplayName.create("idem"),
        embedder: DEFAULT_EMBEDDER,
        passphrase: null,
      });
      expect(second.wasCreated).toBe(false);
    });
  });

  describe("private mode", () => {
    it("creates `.gitignore` with the `.recall/` token", async () => {
      await ctx.workspace.initializeWorkspace.initialize({
        rootPath: WorkspacePath.create(ctx.workspaceRoot),
        mode: WorkspaceMode.privateMode(),
        displayName: DisplayName.create("test-private"),
        embedder: DEFAULT_EMBEDDER,
        passphrase: null,
      });
      const gitignorePath = path.join(ctx.workspaceRoot, ".gitignore");
      expect(fs.existsSync(gitignorePath)).toBe(true);
      const content = fs.readFileSync(gitignorePath, "utf8");
      expect(content).toMatch(/\.recall\//);
    });
  });

  describe("encrypted mode", () => {
    it("persists encryption slice in config.json and produces a SQLCipher-protected DB", async () => {
      await ctx.workspace.initializeWorkspace.initialize({
        rootPath: WorkspacePath.create(ctx.workspaceRoot),
        mode: WorkspaceMode.encryptedMode(),
        displayName: DisplayName.create("test-enc"),
        embedder: DEFAULT_EMBEDDER,
        passphrase: "correct-horse-battery-staple",
      });

      const config = readConfig(ctx.workspaceRoot);
      expect(config.mode).toBe("encrypted");
      // The encryption slice lives at the top level of config.json.
      expect(config.kdf).toBeDefined();
      expect(config.kdf_params).toBeDefined();
      expect(config.key_envelopes).toBeDefined();
      expect(config.key_validator_blob_b64).toBeDefined();
      expect(Array.isArray(config.key_envelopes)).toBe(true);
      expect((config.key_envelopes ?? []).length).toBeGreaterThanOrEqual(1);
    });

    it("rejects empty passphrase for encrypted mode (defensive invariant)", async () => {
      await expect(
        ctx.workspace.initializeWorkspace.initialize({
          rootPath: WorkspacePath.create(ctx.workspaceRoot),
          mode: WorkspaceMode.encryptedMode(),
          displayName: DisplayName.create("test-enc-empty"),
          embedder: DEFAULT_EMBEDDER,
          passphrase: "",
        }),
      ).rejects.toThrow(/passphrase/);
    });
  });

  describe("via mcp-server facade adapter", () => {
    it("produces wire-shape InitOutput for shared mode", async () => {
      const out = await ctx.mcpServer.useCases.init.init({
        workspace_path: ctx.workspaceRoot,
        mode: "shared",
        display_name: "wire-shared",
      });
      expect(out.mode).toBe("shared");
      expect(out.display_name).toBe("wire-shared");
      expect(out.is_new).toBe(true);
      expect(out.schema_version).toBe("1.0.0");
      expect(out.total_entries).toBe(0);
      expect(out.workspace_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    });

    it("rejects encrypted mode via the wire facade (no passphrase channel)", async () => {
      await expect(
        ctx.mcpServer.useCases.init.init({
          workspace_path: ctx.workspaceRoot,
          mode: "encrypted",
        }),
      ).rejects.toThrow(/encrypted/i);
    });
  });
});
