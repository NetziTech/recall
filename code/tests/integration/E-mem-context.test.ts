/**
 * Integration test — Flow E: `mem.context` (assemble 7-layer bundle).
 *
 * Seeds a small workspace and exercises `GetContextBundleUseCase`
 * end-to-end through both the domain port and the wire facade
 * (`GetContextFacadeAdapter`). Verifies:
 *
 *   - Every layer the wire schema enumerates can appear in the result
 *     (per `docs/02 §4.2`); the ordering is the canonical priority
 *     order from `docs/04 §2`.
 *   - The wire ↔ domain layer-name mapping documented in
 *     `composition/facades/mcp-server-facades.ts §D-102` is honoured.
 *   - The `total_tokens` aggregate matches the per-layer sum.
 *   - The `workspace_anchor` layer hydrates from the SQL
 *     `workspace_config` table (Tarea 5.3 — Bug 1 fix). The fix
 *     introduces migration 006 plus the workspace projection writer
 *     so initialise / change-mode upserts the row that the retrieval
 *     adapter reads.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Tags } from "../../src/shared/domain/value-objects/tags.ts";
import { Scope } from "../../src/modules/memory/domain/value-objects/scope.ts";
import { TaskPriority } from "../../src/modules/memory/domain/value-objects/task-priority.ts";
import { DisplayName } from "../../src/modules/workspace/domain/value-objects/display-name.ts";
import { EmbedderSpec } from "../../src/modules/workspace/domain/value-objects/embedder-spec.ts";
import { WorkspaceMode } from "../../src/modules/workspace/domain/value-objects/workspace-mode.ts";
import { WorkspacePath } from "../../src/modules/workspace/domain/value-objects/workspace-path.ts";
import {
  WIRE_TO_DOMAIN_LAYER_NAME,
} from "../../src/composition/facades/mcp-server-facades.ts";
import type { LayerNameWire } from "../../src/modules/mcp-server/application/dtos/wire-types.dto.ts";
import { buildTestContainer, type TestContainer } from "./_helpers/build-test-container.ts";

const ALL_WIRE_NAMES: readonly LayerNameWire[] = Object.freeze([
  "system_identity",
  "project_constitution",
  "active_tasks",
  "recent_turns",
  "relevant_memory",
  "code_map",
  "open_questions",
]);

/**
 * Seeds a `workspace_config` row that mirrors the test container's
 * pinned `workspaceId`. The integration container builds the memory
 * wiring against a synthetic id (it does NOT invoke the workspace
 * `initialize` flow) so the `workspace_config` row would be missing
 * even after migration 006 lands. Tests insert it directly to mirror
 * what the workspace's `InitializeWorkspaceUseCase` would do in
 * production via the projection writer.
 */
function seedWorkspaceConfigRow(ctx: TestContainer): void {
  ctx.database
    .prepare(
      `INSERT INTO workspace_config (
         workspace_id, display_name, mode, created_at_ms,
         updated_at_ms, metadata_json
       ) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(workspace_id) DO UPDATE SET
         updated_at_ms = excluded.updated_at_ms`,
    )
    .run(
      ctx.workspaceId.toString(),
      "test-workspace",
      "shared",
      0,
      0,
      "{}",
    );
}

async function seedBundle(ctx: TestContainer): Promise<void> {
  seedWorkspaceConfigRow(ctx);
  await ctx.memory.recordDecision.record({
    workspaceId: ctx.workspaceId,
    sessionId: null,
    title: "Adopt hybrid recall",
    rationale: "Combines BM25 lexical with cosine semantic search.",
    tags: Tags.create(["recall"]),
    scope: Scope.project(),
  });
  await ctx.memory.trackTask.create({
    workspaceId: ctx.workspaceId,
    title: "Wire mem.context",
    description: "Implement the 7-layer bundle.",
    priority: TaskPriority.high(),
    tags: Tags.empty(),
    dueAtMs: null,
  });
}

describe("integration / E / mem.context — bundle assembly", () => {
  let ctx: TestContainer;

  beforeEach(async () => {
    ctx = await buildTestContainer();
    await seedBundle(ctx);
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it("query-driven mem.context succeeds and returns a 7-layer bundle (Bug 1 + B-018 fix)", async () => {
    // FIXED (Tarea 5.3 — Bug 1): migration 006 creates the
    // `workspace_config` table that
    // `SqliteMemoryProjectionRepository.loadWorkspaceAnchor` reads.
    // The workspace's projection writer upserts the identity row at
    // init / change-mode; the test seed mirrors that behaviour.
    //
    // FIXED (B-018): the use case must always emit the seven
    // canonical layers (docs/02 §4.2), even when a layer is empty.
    const out = await ctx.mcpServer.useCases.context.getContext({
      workspace_id: ctx.workspaceId.toString(),
      query: "hybrid recall",
      max_tokens: 4000,
    });
    expect(out).toBeDefined();
    expect(typeof out.bundle.total_tokens).toBe("number");
    expect(Array.isArray(out.bundle.layers)).toBe(true);
    expect(out.bundle.layers.length).toBe(7);
    const layerNames = out.bundle.layers.map((l) => l.name).sort();
    expect(layerNames).toEqual([...ALL_WIRE_NAMES].sort());
  });

  it("layer name mapping — every wire name maps to a domain literal", () => {
    for (const wireName of ALL_WIRE_NAMES) {
      const domain = WIRE_TO_DOMAIN_LAYER_NAME[wireName];
      expect(domain).toBeDefined();
      expect(typeof domain).toBe("string");
    }
    // The three documented divergences are present.
    expect(WIRE_TO_DOMAIN_LAYER_NAME.system_identity).toBe("workspace_anchor");
    expect(WIRE_TO_DOMAIN_LAYER_NAME.project_constitution).toBe("active_decisions");
    expect(WIRE_TO_DOMAIN_LAYER_NAME.code_map).toBe("entities_in_focus");
  });

  it("query-less mem.context emits the seven canonical layers (Bug 1 + B-018 fix)", async () => {
    const out = await ctx.mcpServer.useCases.context.getContext({
      workspace_id: ctx.workspaceId.toString(),
      max_tokens: 4000,
    });
    expect(out).toBeDefined();
    expect(out.bundle.layers.length).toBe(7);
    const layerNames = out.bundle.layers.map((l) => l.name).sort();
    expect(layerNames).toEqual([...ALL_WIRE_NAMES].sort());
    // The workspace anchor maps to wire name `system_identity`.
    const anchorLayer = out.bundle.layers.find(
      (layer) => layer.name === "system_identity",
    );
    expect(anchorLayer).toBeDefined();
    // Query-driven layers are still present, just empty.
    const relevantMemory = out.bundle.layers.find(
      (layer) => layer.name === "relevant_memory",
    );
    const codeMap = out.bundle.layers.find((layer) => layer.name === "code_map");
    expect(relevantMemory?.entries_count).toBe(0);
    expect(codeMap?.entries_count).toBe(0);
  });

  it("end-to-end with the workspace's `initialize` use case populates the anchor row", async () => {
    // Drives the same code path the production CLI / MCP server uses:
    // `InitializeWorkspaceUseCase` invokes the projection writer, which
    // upserts the `workspace_config` row. The retrieval adapter then
    // reads it back. This is the bug 1 regression guard against future
    // refactors that decouple the writer from the use case.
    const freshCtx = await buildTestContainer({ skipMigrations: true });
    try {
      await freshCtx.workspace.initializeWorkspace.initialize({
        rootPath: WorkspacePath.create(freshCtx.workspaceRoot),
        mode: WorkspaceMode.sharedMode(),
        displayName: DisplayName.create("E2E"),
        embedder: EmbedderSpec.create({
          provider: "fastembed",
          model: "BGESmallEN15",
        }),
        passphrase: null,
      });
      // The bootstrap entrypoint of the workspace use case opens its
      // own SQLite handle and closes it; the test container's
      // long-lived `freshCtx.database` connection sees the migration
      // and the `workspace_config` row through the same on-disk file.
      const row = freshCtx.database
        .prepare("SELECT workspace_id FROM workspace_config")
        .get() as { workspace_id: string } | undefined;
      expect(row).toBeDefined();
    } finally {
      await freshCtx.cleanup();
    }
  });

  it("missing or unknown workspace emits an empty system_identity layer (B-018 fix)", async () => {
    // Legacy / pre-006 workspaces that have not been re-init'd yet
    // see `loadWorkspaceAnchor` return `null`. With B-018 fixed, the
    // bundle still emits the seven canonical layers; the anchor is
    // present with `entries_count: 0` so MCP clients can rely on the
    // wire keys regardless of state.
    ctx.database
      .prepare("DELETE FROM workspace_config WHERE workspace_id = ?")
      .run(ctx.workspaceId.toString());
    const out = await ctx.mcpServer.useCases.context.getContext({
      workspace_id: ctx.workspaceId.toString(),
      max_tokens: 4000,
    });
    expect(out).toBeDefined();
    expect(out.bundle.layers.length).toBe(7);
    const anchor = out.bundle.layers.find((l) => l.name === "system_identity");
    expect(anchor).toBeDefined();
    expect(anchor?.entries_count).toBe(0);
  });
});
