/**
 * Integration test — Flow M: `mem.health` reports REAL workspace state.
 *
 * Regression for Bug B-MCP-2 (https://github.com/NetziTech/recall/issues/1):
 * `CheckHealthFacadeAdapter` returned 8 hardcoded values for fields it
 * was supposed to derive from the live database. The diagnostic tool
 * was lying — `total_entries: 0` while the DB had 31 entries,
 * `mode: "shared"` while the workspace was `private`, etc.
 *
 * Methodology — VALUES, not SHAPE (Phase-9 lesson):
 *   1. Build a known state: insert 1 decision + 2 learnings + 1
 *      entity through the production use cases. Open a session via
 *      direct SQL (the session lifecycle is owned by the curator,
 *      out of scope for this test). Set the workspace mode to
 *      `private` via the workspace_config row created by the
 *      bootstrap path of the test container.
 *   2. Invoke `CheckHealthFacadeAdapter.health({})` exactly the way
 *      the JSON-RPC dispatcher does for an MCP `tools/call` (with
 *      empty arguments — the workspace_id falls back to the
 *      bootstrap-injected default).
 *   3. Assert each formerly-hardcoded field reflects the REAL state:
 *      mode, total_entries, entries_by_kind, size_bytes.memoria_db,
 *      active_session, embedding_queue_pending. Plus the wire-side
 *      back-compat shape (memoria_db / vectors_db keys).
 *   4. Negative side: `last_curator_run` is still null because no
 *      curator run has been written. `encryption_status` is "n/a"
 *      because mode is `private`, not `encrypted`.
 *
 * Why this catches B-MCP-2: every hardcoded literal in the prior
 * facade is asserted against a value DIFFERENT from the literal. If
 * a future refactor reverts to hardcoded zeros / nulls, the asserts
 * fail loudly.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Tags } from "../../src/shared/domain/value-objects/tags.ts";
import { EntityKind } from "../../src/modules/memory/domain/value-objects/entity-kind.ts";
import { LearningSeverity } from "../../src/modules/memory/domain/value-objects/learning-severity.ts";
import { Scope } from "../../src/modules/memory/domain/value-objects/scope.ts";
import { CheckHealthFacadeAdapter } from "../../src/composition/facades/mcp-server-facades.ts";
import { SqliteWorkspaceStateReader } from "../../src/composition/queries/sqlite-workspace-state-reader.ts";
import {
  buildTestContainer,
  type TestContainer,
} from "./_helpers/build-test-container.ts";

const SCHEMA_VERSION = "1.0.0";
const EMBEDDING_MODEL = "fastembed:BGESmallEN15";

function buildHealthFacade(ctx: TestContainer): CheckHealthFacadeAdapter {
  // Reuses the production wiring: same reader, same use case, same
  // workspace id. The only deviation from the production container
  // is that we instantiate the adapter outside `buildContainer` so
  // the test owns the lifecycle.
  return new CheckHealthFacadeAdapter(
    ctx.workspace.healthCheck,
    new SqliteWorkspaceStateReader(ctx.database, ctx.logger),
    ctx.workspaceRoot,
    SCHEMA_VERSION,
    EMBEDDING_MODEL,
    ctx.workspaceId,
  );
}

/**
 * Seeds `workspace_config` with a row for the test container's
 * workspaceId and the requested mode. The test container does not
 * call `recall init`, so the row is absent by default and the
 * reader's mode lookup returns the safe-default `"shared"`.
 */
function seedWorkspaceConfig(
  ctx: TestContainer,
  mode: "shared" | "encrypted" | "private",
): void {
  const stmt = ctx.database.prepare(
    "INSERT OR REPLACE INTO workspace_config (workspace_id, display_name, mode, created_at_ms, updated_at_ms, metadata_json) VALUES (?, ?, ?, ?, ?, ?)",
  );
  stmt.run(
    ctx.workspaceId.toString(),
    "Recall (test)",
    mode,
    1_700_000_000_000,
    1_700_000_000_000,
    "{}",
  );
}

/**
 * Inserts a session row directly via SQL because session lifecycle
 * is owned by the curator module and not invoked through the recording
 * use cases. The reader queries `WHERE ended_at_ms IS NULL`, so an
 * `ended_at_ms` of `null` makes the session active.
 */
function seedActiveSession(ctx: TestContainer, sessionId: string): void {
  const stmt = ctx.database.prepare(
    "INSERT INTO sessions (id, started_at_ms, ended_at_ms, intent, summary, next_seed, resumed_from, turns_count, metadata_json) VALUES (?, ?, NULL, NULL, NULL, NULL, NULL, 0, '{}')",
  );
  stmt.run(sessionId, 1_700_000_001_000);
}

describe("integration / M / mem.health reports real workspace state (B-MCP-2)", () => {
  let ctx: TestContainer;

  beforeEach(async () => {
    ctx = await buildTestContainer();
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it("returns real counts, sizes, and mode after seeding 4 memories + 1 session", async () => {
    seedWorkspaceConfig(ctx, "private");
    seedActiveSession(ctx, "01940000-0000-7000-8000-000000000abc");

    await ctx.memory.recordDecision.record({
      workspaceId: ctx.workspaceId,
      sessionId: null,
      title: "Persist mem.health real state",
      rationale:
        "Hardcoded diagnostics misled the dogfood; reader unifies the cross-module reads.",
      tags: Tags.create(["diagnostics"]),
      scope: Scope.project(),
    });
    await ctx.memory.recordLearning.record({
      workspaceId: ctx.workspaceId,
      text: "Validate VALUES of MCP tool responses, not just SHAPE.",
      severity: LearningSeverity.critical(),
      tags: Tags.create(["testing"]),
      scope: Scope.project(),
    });
    await ctx.memory.recordLearning.record({
      workspaceId: ctx.workspaceId,
      text: "mem.health hardcoded 8 wire fields prior to v0.1.2-beta.2.",
      severity: LearningSeverity.warning(),
      tags: Tags.create(["regression"]),
      scope: Scope.project(),
    });
    await ctx.memory.recordEntity.record({
      workspaceId: ctx.workspaceId,
      name: "WorkspaceStateReader",
      kind: EntityKind.moduleKind(),
      description:
        "Outbound port of mcp-server consumed by CheckHealthFacadeAdapter; implemented in composition with cross-module SQL.",
      tags: Tags.create(["mcp-server", "reader"]),
      scope: Scope.project(),
    });

    const facade = buildHealthFacade(ctx);
    const out = await facade.health({});

    // ── Identity ─────────────────────────────────────────────────
    expect(out.schema_version).toBe(SCHEMA_VERSION);
    expect(out.workspace_id).toBe(ctx.workspaceId.toString());
    expect(out.embedding_model).toBe(EMBEDDING_MODEL);

    // ── Mode + encryption (formerly hardcoded "shared" / "n/a") ──
    expect(out.mode).toBe("private");
    expect(out.encryption_status).toBe("n/a");

    // ── Counts (formerly hardcoded 0 / {}) ───────────────────────
    expect(out.total_entries).toBe(4);
    expect(out.entries_by_kind).toMatchObject({
      decision: 1,
      learning: 2,
      entity: 1,
      task: 0,
      turn: 0,
    });

    // ── File sizes (formerly hardcoded { 0, 0 }) ─────────────────
    // Back-compat field names: `memoria_db` (legacy) + `vectors_db`
    // (legacy; vec0 storage is bundled inside recall.db).
    expect(Object.keys(out.size_bytes).sort()).toEqual([
      "memoria_db",
      "vectors_db",
    ]);
    expect(out.size_bytes.memoria_db).toBeGreaterThan(0);
    expect(out.size_bytes.vectors_db).toBe(0);

    // ── Active session (formerly hardcoded null) ─────────────────
    expect(out.active_session).not.toBeNull();
    expect(out.active_session?.id).toBe(
      "01940000-0000-7000-8000-000000000abc",
    );
    expect(out.active_session?.started_at).toBe(1_700_000_001_000);

    // ── Embedding queue (formerly hardcoded 0) ───────────────────
    // The recording use cases enqueue one embedding job per memory;
    // four memories were inserted, so the queue depth is 4. The
    // worker is not started in this test, so nothing drains.
    expect(out.embedding_queue_pending).toBe(4);

    // ── Curator (still null because no curator run was written) ──
    expect(out.last_curator_run).toBeNull();

    // The probe-derived `fts_health` and `vector_index_health` are
    // produced by the workspace's `HealthCheckUseCase`, not by the
    // reader under test. The test container does not run
    // `recall init` so the probe reports the workspace as
    // "not found" → those fields land on `"rebuild_recommended"`,
    // which is irrelevant to B-MCP-2 (the bug was about the OTHER
    // 8 fields). The dedicated workspace integration test
    // exercises the probe path.
  });

  it("reports `mode='shared'` and `encryption_status='n/a'` when workspace_config is missing", async () => {
    // The reader's safe default for missing config is `shared`.
    // This exercises the "init not yet run" path where the bootstrap
    // injects the placeholder workspace id and no workspace_config
    // row exists.
    const facade = buildHealthFacade(ctx);
    const out = await facade.health({});
    expect(out.mode).toBe("shared");
    expect(out.encryption_status).toBe("n/a");
    expect(out.total_entries).toBe(0);
    expect(out.embedding_queue_pending).toBe(0);
    expect(out.active_session).toBeNull();
    expect(out.last_curator_run).toBeNull();
  });

  it("reports `encryption_status='locked'` for an encrypted workspace (runtime unlock probe is out of scope)", async () => {
    seedWorkspaceConfig(ctx, "encrypted");
    const facade = buildHealthFacade(ctx);
    const out = await facade.health({});
    expect(out.mode).toBe("encrypted");
    // Documented limitation: the reader does not have access to the
    // bootstrap closure that holds the unlocked key, so it always
    // reports "locked" for encrypted workspaces. A follow-up will
    // surface the runtime unlock state through a separate probe.
    expect(out.encryption_status).toBe("locked");
  });
});
