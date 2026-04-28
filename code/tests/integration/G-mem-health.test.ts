/**
 * Integration test — Flow G: `mem.health` (health check).
 *
 * Exercises the wired `HealthCheckUseCase` end-to-end. Verifies:
 *
 *   - On a healthy workspace, every probe (`workspace.exists`,
 *     `workspace.parseable`, `database.openable`, `migrations.current`,
 *     `embedder.loadable`) reports `pass` (modulo the deferred
 *     `gitignore.consistent` which is documented to skip).
 *   - On a non-existent workspace, the probe short-circuits with a
 *     `workspace.exists: fail` and skips downstream checks.
 *   - The wire facade (`CheckHealthFacadeAdapter`) stitches the probe
 *     into a wire envelope.
 */
import * as fs from "node:fs";
import * as os from "node:os";
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

describe("integration / G / mem.health — workspace + database + embedder probes", () => {
  describe("healthy workspace", () => {
    let ctx: TestContainer;

    beforeEach(async () => {
      ctx = await buildTestContainer({ skipMigrations: true });
      await ctx.workspace.initializeWorkspace.initialize({
        rootPath: WorkspacePath.create(ctx.workspaceRoot),
        mode: WorkspaceMode.sharedMode(),
        displayName: DisplayName.create("healthy"),
        embedder: DEFAULT_EMBEDDER,
        passphrase: null,
      });
    });

    afterEach(async () => {
      await ctx.cleanup();
    });

    it("returns `healthy: true` and every probe passes (except the deferred gitignore one)", async () => {
      const result = await ctx.workspace.healthCheck.check({
        rootPath: WorkspacePath.create(ctx.workspaceRoot),
      });
      expect(result.healthy).toBe(true);
      const byId = new Map(result.checks.map((c) => [c.id, c]));
      expect(byId.get("workspace.exists")?.status).toBe("pass");
      expect(byId.get("workspace.parseable")?.status).toBe("pass");
      expect(byId.get("database.openable")?.status).toBe("pass");
      expect(byId.get("migrations.current")?.status).toBe("pass");
      expect(byId.get("embedder.loadable")?.status).toBe("pass");
      // gitignore.consistent is deferred (TODO-WS-1).
      expect(byId.get("gitignore.consistent")?.status).toBe("skipped");
    });
  });

  describe("non-existent workspace", () => {
    let ctx: TestContainer;
    let bareRoot: string;

    beforeEach(async () => {
      ctx = await buildTestContainer({ skipMigrations: true });
      bareRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mem-int-bare-"));
    });

    afterEach(async () => {
      await ctx.cleanup();
      fs.rmSync(bareRoot, { recursive: true, force: true });
    });

    it("reports `workspace.exists: fail` and skips downstream checks", async () => {
      const result = await ctx.workspace.healthCheck.check({
        rootPath: WorkspacePath.create(bareRoot),
      });
      expect(result.healthy).toBe(false);
      const byId = new Map(result.checks.map((c) => [c.id, c]));
      expect(byId.get("workspace.exists")?.status).toBe("fail");
      // Downstream checks are reported as `skipped`.
      expect(byId.get("database.openable")?.status).toBe("skipped");
      expect(byId.get("embedder.loadable")?.status).toBe("skipped");
    });
  });

  describe("via wire facade", () => {
    let ctx: TestContainer;

    beforeEach(async () => {
      ctx = await buildTestContainer({ skipMigrations: true });
      await ctx.workspace.initializeWorkspace.initialize({
        rootPath: WorkspacePath.create(ctx.workspaceRoot),
        mode: WorkspaceMode.sharedMode(),
        displayName: DisplayName.create("wire-health"),
        embedder: DEFAULT_EMBEDDER,
        passphrase: null,
      });
    });

    afterEach(async () => {
      await ctx.cleanup();
    });

    it("returns wire-shape HealthOutput on a healthy workspace", async () => {
      // The wire adapter resolves `process.cwd()` for the workspace
      // path. We chdir into the test workspace so the probe finds the
      // freshly-initialised workspace, then restore.
      const previousCwd = process.cwd();
      try {
        process.chdir(ctx.workspaceRoot);
        const out = await ctx.mcpServer.useCases.health.health({
          workspace_id: ctx.workspaceId.toString(),
        });
        expect(out.schema_version).toBe("1.0.0");
        expect(out.workspace_id).toBe(ctx.workspaceId.toString());
        expect(out.embedding_model).toBe("fastembed:BGESmallEN15");
        expect(out.fts_health).toBe("ok");
        expect(out.vector_index_health).toBe("ok");
      } finally {
        process.chdir(previousCwd);
      }
    });
  });
});
