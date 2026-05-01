/**
 * Integration test — Flow N: `mem.remember(kind=decision)` content
 * round-trips through SQL and back through `mem.recall`.
 *
 * Regression for Bug B-MCP-4 (https://github.com/NetziTech/recall/issues/3):
 * the `decisions` table had no `content` column, so the canonical
 * full-text body documented in `docs/02 §4.4` was silently dropped
 * during persistence. Migration 008 added the column, the aggregate
 * carries it, and the recall projection surfaces it back to wire.
 *
 * Methodology — VALUES, not SHAPE (Phase-9 lesson):
 *   1. Establish known state: workspace has zero decisions.
 *   2. Invoke `mem.remember` (the wire facade) with kind=decision,
 *      a SHORT rationale, and a LONG content paragraph distinct from
 *      the rationale. The two strings must NOT contain the same
 *      tokens so we can prove which one came back later.
 *   3. Inspect the SQL row directly: the `content` column must equal
 *      the long body, and the `rationale` column must equal the
 *      short rationale.
 *   4. Issue `mem.recall` for a token that appears ONLY in `content`
 *      (not in title or rationale). The hit must come back, and the
 *      wire `content` field of the response must equal the long
 *      content body — not the rationale (the pre-fix behaviour).
 *
 * Why this catches B-MCP-4: the test is built around the exact
 * sentence pairs that the v0.1.x behaviour confused — a rationale
 * that DIFFERS from the content. The pre-fix code path stored
 * rationale and returned rationale-as-content; this test asserts that
 * the post-fix code stores AND returns the actual content.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Tags } from "../../src/shared/domain/value-objects/tags.ts";
import { Scope } from "../../src/modules/memory/domain/value-objects/scope.ts";
import {
  buildTestContainer,
  type TestContainer,
} from "./_helpers/build-test-container.ts";

const RATIONALE = "Choose SQLite for portability";
const CONTENT_BODY =
  "The team evaluated PostgreSQL, DuckDB, and SQLite. The deciding factor was the file-per-workspace deployment model that keeps the memory binary self-contained without a server process. The hexagonal architecture lets us swap engines later if a benchmark forces the choice.";

describe("integration / N / mem.remember(decision) content round-trips (B-MCP-4)", () => {
  let ctx: TestContainer;

  beforeEach(async () => {
    ctx = await buildTestContainer();
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it("persists `content` to the SQL column and surfaces it back through recall", async () => {
    const remember = await ctx.mcpServer.useCases.remember.remember({
      workspace_id: ctx.workspaceId.toString(),
      kind: "decision",
      title: "Pick SQLite",
      rationale: RATIONALE,
      content: CONTENT_BODY,
      tags: ["persistence", "decision"],
    });
    expect(remember.id.length).toBeGreaterThan(0);

    // ── SQL inspection: the content column must hold the long body,
    //    NOT the rationale (the v0.1.x silent-drop behaviour).
    const row = ctx.database
      .prepare("SELECT title, rationale, content FROM decisions WHERE id = ?")
      .get(remember.id) as
      | { readonly title: string; readonly rationale: string; readonly content: string }
      | undefined;
    expect(row).toBeDefined();
    expect(row?.title).toBe("Pick SQLite");
    expect(row?.rationale).toBe(RATIONALE);
    expect(row?.content).toBe(CONTENT_BODY);
    // Sanity check: rationale and content are intentionally different
    // so the assertion above is meaningful.
    expect(row?.content).not.toBe(row?.rationale);

    // ── Wire round-trip: recall a token that only appears in `content`
    //    (not in title or rationale). Pre-fix this returned zero hits
    //    because the content was never persisted — the FTS index only
    //    contained title + rationale. Migration 008 rebuilt the FTS
    //    index over content, so the token now matches.
    const recall = await ctx.mcpServer.useCases.recall.recall({
      workspace_id: ctx.workspaceId.toString(),
      query: "PostgreSQL DuckDB",
      top_k: 5,
      max_tokens: 4000,
    });
    expect(recall.results.length).toBeGreaterThan(0);
    const hit = recall.results.find((r) => r.id === remember.id);
    expect(hit).toBeDefined();
    // The wire `content` field must reflect the full long body, not
    // the rationale. Pre-fix this was always the rationale.
    expect(hit?.content).toBe(CONTENT_BODY);
  });

  it("falls back to rationale when content is omitted (defensive default)", async () => {
    // Internal CLI workflows or scripted seeds may not supply
    // `content`. The use case defaults to `rationale` so the
    // persisted column stays non-empty and the FTS index keeps the
    // entry searchable.
    const result = await ctx.memory.recordDecision.record({
      workspaceId: ctx.workspaceId,
      sessionId: null,
      title: "Internal seed without content",
      rationale: "Backfill default kicks in",
      // intentionally no `content` field — the use case must default
      // to rationale so the persisted column stays non-empty.
      tags: Tags.empty(),
      scope: Scope.project(),
    });

    const row = ctx.database
      .prepare("SELECT rationale, content FROM decisions WHERE id = ?")
      .get(result.decisionId.toString()) as
      | { readonly rationale: string; readonly content: string }
      | undefined;
    expect(row).toBeDefined();
    expect(row?.rationale).toBe("Backfill default kicks in");
    expect(row?.content).toBe("Backfill default kicks in");
  });
});
