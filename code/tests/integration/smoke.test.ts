/**
 * Smoke test for the integration container helper.
 *
 * Verifies that `buildTestContainer` produces a fully wired graph and
 * that the database has the expected schema. Every other integration
 * test file builds on this assertion.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildTestContainer, type TestContainer } from "./_helpers/build-test-container.ts";

describe("integration / smoke / container wiring", () => {
  let ctx: TestContainer;

  beforeEach(async () => {
    ctx = await buildTestContainer();
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it("wires every module's bag (workspace, memory, retrieval, curator, mcp-server, cli, encryption, secrets)", () => {
    expect(ctx.workspace.initializeWorkspace).toBeDefined();
    expect(ctx.memory.recordDecision).toBeDefined();
    expect(ctx.retrieval.recallMemory).toBeDefined();
    expect(ctx.curator.runCurator).toBeDefined();
    expect(ctx.mcpServer.dispatcher).toBeDefined();
    expect(ctx.cli.entrypoint).toBeDefined();
    expect(ctx.encryption.initializeEncryption).toBeDefined();
    expect(ctx.secrets.scanText).toBeDefined();
  });

  it("applied every shipped migration (000-007)", () => {
    const stmt = ctx.database.prepare(
      "SELECT version FROM schema_migrations ORDER BY version ASC",
    );
    const rows = stmt.all() as { readonly version: number }[];
    const versions = rows.map((r) => r.version);
    // Migration 006 (Tarea 5.3 — Bug 1 fix) creates `workspace_config`
    // so the retrieval module's `loadWorkspaceAnchor` can hydrate the
    // `mem.context` system_identity layer.
    // Migration 007 (Tarea 5.4 — Bug F fix) scopes the FTS5 `*_au`
    // triggers to only fire when an FTS-mirrored column changes, so
    // the curator's `applyDecayBatch` UPDATEs do not pay a full FTS5
    // reindex per row.
    expect(versions).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("registered the six MVP tools on the registry", () => {
    const tools = ctx.mcpServer.registry.listAll();
    const names = tools.map((t) => t.name.toString());
    expect(names).toContain("mem.init");
    expect(names).toContain("mem.context");
    expect(names).toContain("mem.recall");
    expect(names).toContain("mem.remember");
    expect(names).toContain("mem.task");
    expect(names).toContain("mem.health");
  });

  it("exposes the stub embedder under the cross-module embedder port", () => {
    expect(ctx.embedder.dimension()).toBe(384);
  });
});
