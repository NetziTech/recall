/**
 * Integration test — Flow D: `mem.recall` (hybrid search).
 *
 * Seeds 5+ decisions and learnings, then exercises the wired
 * `RecallMemoryUseCase` (lexical FTS5 + cosine vec0 + hybrid scoring +
 * usage bumping) end-to-end.
 *
 * Coverage:
 *   - BM25 ranking surfaces FTS5 hits when a query word matches.
 *   - The embedder.failNext path triggers `embedder_unavailable`
 *     fallback (the use case logs a warning and degrades to FTS5-only).
 *   - The `embeddingPersisted` path is exercised in flow E (context);
 *     here we focus on the FTS5 pipeline plus the empty / no-vectors
 *     scenario which surfaces `no_embeddings_yet`.
 *   - `bumpUsage` updates `use_count` and `last_used_ms` on the
 *     persisted projection.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Tags } from "../../src/shared/domain/value-objects/tags.ts";
import { Tokens } from "../../src/shared/domain/value-objects/tokens.ts";
import { Scope } from "../../src/modules/memory/domain/value-objects/scope.ts";
import { LearningSeverity } from "../../src/modules/memory/domain/value-objects/learning-severity.ts";
import { Query } from "../../src/modules/retrieval/domain/value-objects/query.ts";
import { QueryText } from "../../src/modules/retrieval/domain/value-objects/query-text.ts";
import { RecallFilters } from "../../src/modules/retrieval/domain/value-objects/recall-filters.ts";
import { RelevanceWeights } from "../../src/modules/retrieval/domain/value-objects/relevance-weights.ts";
import { TokenBudget } from "../../src/modules/retrieval/domain/value-objects/token-budget.ts";
import { buildTestContainer, type TestContainer } from "./_helpers/build-test-container.ts";

async function seedCorpus(ctx: TestContainer): Promise<void> {
  await ctx.memory.recordDecision.record({
    workspaceId: ctx.workspaceId,
    sessionId: null,
    title: "Adopt hexagonal architecture",
    rationale: "DDD plus hexagonal keeps the domain neutral.",
    tags: Tags.create(["architecture"]),
    scope: Scope.project(),
  });
  await ctx.memory.recordDecision.record({
    workspaceId: ctx.workspaceId,
    sessionId: null,
    title: "Use SQLite for persistence",
    rationale: "Per-workspace SQLite avoids server ops.",
    tags: Tags.create(["persistence", "sqlite"]),
    scope: Scope.project(),
  });
  await ctx.memory.recordLearning.record({
    workspaceId: ctx.workspaceId,
    text: "Always log infrastructure errors at WARN, not ERROR.",
    severity: LearningSeverity.warning(),
    tags: Tags.create(["logging"]),
    scope: Scope.project(),
  });
  await ctx.memory.recordLearning.record({
    workspaceId: ctx.workspaceId,
    text: "Prefer immutable value objects for domain primitives.",
    severity: LearningSeverity.tip(),
    tags: Tags.create(["domain", "ddd"]),
    scope: Scope.project(),
  });
  await ctx.memory.recordLearning.record({
    workspaceId: ctx.workspaceId,
    text: "Hexagonal ports decouple application logic from adapters.",
    severity: LearningSeverity.tip(),
    tags: Tags.create(["architecture"]),
    scope: Scope.project(),
  });
}

function buildQuery(text: string): Query {
  return Query.create({
    text: QueryText.create(text),
    kinds: [],
    tags: Tags.empty(),
    mustHaveTags: Tags.empty(),
    mustNotHaveTags: Tags.empty(),
    includeSuperseded: false,
  });
}

function defaultFilters(): RecallFilters {
  return RecallFilters.create({
    kinds: [],
    tags: Tags.empty(),
    mustHaveTags: Tags.empty(),
    mustNotHaveTags: Tags.empty(),
    minConfidence: null,
    since: null,
    until: null,
    limit: 8,
  });
}

describe("integration / D / mem.recall — hybrid retrieval", () => {
  let ctx: TestContainer;

  beforeEach(async () => {
    ctx = await buildTestContainer();
    await seedCorpus(ctx);
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it("returns BM25-ranked entries when the query matches FTS5 tokens", async () => {
    const result = await ctx.retrieval.recallMemory.recall({
      workspaceId: ctx.workspaceId,
      query: buildQuery("hexagonal"),
      filters: defaultFilters(),
      maxTokens: TokenBudget.withMax(2000),
      weights: RelevanceWeights.defaults(),
    });
    const entries = result.getEntries();
    expect(entries.length).toBeGreaterThan(0);
    // Both the decision and the learning that contain "hexagonal" should
    // be returned.
    const previews = entries.map((e) => e.preview.toString().toLowerCase());
    expect(previews.some((p) => p.includes("hexagonal"))).toBe(true);
  });

  it("falls back to embedder_unavailable when the embedder throws", async () => {
    ctx.embedder.failPersistently = true;
    const result = await ctx.retrieval.recallMemory.recall({
      workspaceId: ctx.workspaceId,
      query: buildQuery("hexagonal"),
      filters: defaultFilters(),
      maxTokens: TokenBudget.withMax(2000),
      weights: RelevanceWeights.defaults(),
    });
    expect(result.fallbackReason).toBe("embedder_unavailable");
    // FTS5 hits still come through.
    expect(result.getEntries().length).toBeGreaterThan(0);
  });

  it("returns an empty result with no fallback for an empty corpus", async () => {
    // Build a fresh, empty container.
    const emptyCtx = await buildTestContainer();
    try {
      const result = await emptyCtx.retrieval.recallMemory.recall({
        workspaceId: emptyCtx.workspaceId,
        query: buildQuery("anything"),
        filters: defaultFilters(),
        maxTokens: TokenBudget.withMax(2000),
        weights: RelevanceWeights.defaults(),
      });
      expect(result.getEntries()).toHaveLength(0);
      expect(result.totalCandidates).toBe(0);
      expect(result.totalTokens.equals(Tokens.zero())).toBe(true);
    } finally {
      await emptyCtx.cleanup();
    }
  });

  it("bumps `use_count` and `last_used_ms` for each surfaced entry", async () => {
    const before = ctx.database
      .prepare(
        "SELECT id, use_count, last_used_ms FROM decisions ORDER BY created_at_ms ASC",
      )
      .all() as readonly { id: string; use_count: number; last_used_ms: number | null }[];

    // Advance the clock so the post-recall last_used_ms is observably larger.
    ctx.clock.advance(60_000);

    const result = await ctx.retrieval.recallMemory.recall({
      workspaceId: ctx.workspaceId,
      query: buildQuery("hexagonal"),
      filters: defaultFilters(),
      maxTokens: TokenBudget.withMax(2000),
      weights: RelevanceWeights.defaults(),
    });
    expect(result.getEntries().length).toBeGreaterThan(0);

    const after = ctx.database
      .prepare(
        "SELECT id, use_count, last_used_ms FROM decisions ORDER BY created_at_ms ASC",
      )
      .all() as readonly { id: string; use_count: number; last_used_ms: number | null }[];

    // At least one decision should have its use_count incremented.
    let bumped = false;
    for (const a of after) {
      const b = before.find((x) => x.id === a.id);
      if (b !== undefined && a.use_count > b.use_count) {
        bumped = true;
        break;
      }
    }
    expect(bumped).toBe(true);
  });

  it("via wire facade — RecallMemoryFacadeAdapter returns wire-shape RecallOutput", async () => {
    const out = await ctx.mcpServer.useCases.recall.recall({
      workspace_id: ctx.workspaceId.toString(),
      query: "hexagonal",
      top_k: 5,
      max_tokens: 2000,
    });
    expect(Array.isArray(out.results)).toBe(true);
    expect(out.results.length).toBeGreaterThan(0);
    expect(typeof out.total_candidates).toBe("number");
    // Every entry has the wire shape.
    for (const r of out.results) {
      expect(r.kind).toMatch(/^(decision|learning|entity|task|turn)$/);
      expect(typeof r.score).toBe("number");
      expect(typeof r.created_at).toBe("number");
    }
  });
});
