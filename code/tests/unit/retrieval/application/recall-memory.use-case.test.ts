import { beforeEach, describe, expect, it } from "vitest";

import { RecallMemoryUseCase } from "../../../../src/modules/retrieval/application/use-cases/recall-memory.use-case.ts";
import type {
  MemoryProjection,
  MemoryProjectionRepository,
} from "../../../../src/modules/retrieval/application/ports/out/memory-projection-repository.port.ts";
import type { Embedder } from "../../../../src/modules/retrieval/domain/services/embedder.ts";
import type {
  LexicalSearch,
  LexicalSearchHit,
} from "../../../../src/modules/retrieval/domain/services/lexical-search.ts";
import type { TokenCounter } from "../../../../src/modules/retrieval/domain/services/token-counter.ts";
import type {
  VectorSearch,
  VectorSearchHit,
} from "../../../../src/modules/retrieval/domain/services/vector-search.ts";
import { BM25Score } from "../../../../src/modules/retrieval/domain/value-objects/bm25-score.ts";
import { CosineScore } from "../../../../src/modules/retrieval/domain/value-objects/cosine-score.ts";
import { EmbeddingVector } from "../../../../src/modules/retrieval/domain/value-objects/embedding-vector.ts";
import { QueryKind } from "../../../../src/modules/retrieval/domain/value-objects/query-kind.ts";
import { QueryText } from "../../../../src/modules/retrieval/domain/value-objects/query-text.ts";
import { Query } from "../../../../src/modules/retrieval/domain/value-objects/query.ts";
import { RecallFilters } from "../../../../src/modules/retrieval/domain/value-objects/recall-filters.ts";
import { RelevanceWeights } from "../../../../src/modules/retrieval/domain/value-objects/relevance-weights.ts";
import { TokenBudget } from "../../../../src/modules/retrieval/domain/value-objects/token-budget.ts";
import type { EntityRef } from "../../../../src/modules/retrieval/domain/value-objects/entity-ref.ts";
import type { OpenQuestionRef } from "../../../../src/modules/retrieval/domain/value-objects/open-question-ref.ts";
import type { TaskRef } from "../../../../src/modules/retrieval/domain/value-objects/task-ref.ts";
import type { TurnRef } from "../../../../src/modules/retrieval/domain/value-objects/turn-ref.ts";
import type { DecisionRef } from "../../../../src/modules/retrieval/domain/value-objects/decision-ref.ts";
import type { WorkspaceAnchorPayload } from "../../../../src/modules/retrieval/domain/value-objects/workspace-anchor-payload.ts";
import type { QueryKindValue } from "../../../../src/modules/retrieval/domain/value-objects/query-kind.ts";
import { LastUsed } from "../../../../src/modules/memory/domain/value-objects/last-used.ts";
import { LearningSeverity } from "../../../../src/modules/memory/domain/value-objects/learning-severity.ts";
import { UseCount } from "../../../../src/modules/memory/domain/value-objects/use-count.ts";
import { Confidence } from "../../../../src/shared/domain/value-objects/confidence.ts";
import { Tags } from "../../../../src/shared/domain/value-objects/tags.ts";
import { Timestamp } from "../../../../src/shared/domain/value-objects/timestamp.ts";
import { Tokens } from "../../../../src/shared/domain/value-objects/tokens.ts";
import { FakeClock } from "../../../../src/shared/infrastructure/clock/fake-clock.ts";
import { ANCHOR_TIME_MS, makeWorkspaceId } from "../../../helpers/factories.ts";
import { SilentLogger } from "../../../helpers/test-doubles.ts";

// ─── Test doubles ──────────────────────────────────────────────────────

class StubLexical implements LexicalSearch {
  public hits: readonly LexicalSearchHit[] = [];
  public error: Error | null = null;
  public calls = 0;

  public search(): Promise<readonly LexicalSearchHit[]> {
    this.calls += 1;
    if (this.error !== null) return Promise.reject(this.error);
    return Promise.resolve(this.hits);
  }
}

class StubVector implements VectorSearch {
  public hits: readonly VectorSearchHit[] = [];
  public error: Error | null = null;
  public calls = 0;

  public search(): Promise<readonly VectorSearchHit[]> {
    this.calls += 1;
    if (this.error !== null) return Promise.reject(this.error);
    return Promise.resolve(this.hits);
  }
}

class StubEmbedder implements Embedder {
  public error: Error | null = null;
  public callCount = 0;

  public embed(): Promise<EmbeddingVector> {
    this.callCount += 1;
    if (this.error !== null) return Promise.reject(this.error);
    return Promise.resolve(EmbeddingVector.create(new Float32Array([0.1, 0.2, 0.3])));
  }

  public embedBatch(): Promise<readonly EmbeddingVector[]> {
    return Promise.resolve([]);
  }
}

class StubTokenCounter implements TokenCounter {
  public count(text: string): Tokens {
    return Tokens.of(Math.max(1, Math.ceil(text.length / 4)));
  }
  public countBatch(texts: readonly string[]): Promise<readonly Tokens[]> {
    return Promise.resolve(texts.map((t) => this.count(t)));
  }
}

class StubProjections implements MemoryProjectionRepository {
  public projections: readonly MemoryProjection[] = [];
  public bumpCalls: { kinds: QueryKindValue[]; ids: string[] }[] = [];
  public bumpError: Error | null = null;

  public loadWorkspaceAnchor(): Promise<WorkspaceAnchorPayload | null> {
    return Promise.resolve(null);
  }
  public listActiveDecisions(): Promise<readonly DecisionRef[]> {
    return Promise.resolve([]);
  }
  public listOpenTasks(): Promise<readonly TaskRef[]> {
    return Promise.resolve([]);
  }
  public listRecentTurns(): Promise<readonly TurnRef[]> {
    return Promise.resolve([]);
  }
  public listOpenQuestions(): Promise<readonly OpenQuestionRef[]> {
    return Promise.resolve([]);
  }
  public loadProjectionsByHits(input: {
    hits: readonly { readonly kind: QueryKindValue; readonly id: string }[];
  }): Promise<readonly MemoryProjection[]> {
    const want = new Set(input.hits.map((h) => `${h.kind}::${h.id}`));
    const out = this.projections.filter((p) => want.has(`${p.kind}::${p.id}`));
    return Promise.resolve(out);
  }
  public loadEntityRefsByIds(): Promise<readonly EntityRef[]> {
    return Promise.resolve([]);
  }
  public bumpUsage(input: {
    touched: readonly { readonly kind: QueryKindValue; readonly id: string }[];
  }): Promise<void> {
    if (this.bumpError !== null) return Promise.reject(this.bumpError);
    const kinds: QueryKindValue[] = [];
    const ids: string[] = [];
    for (const t of input.touched) {
      kinds.push(t.kind);
      ids.push(t.id);
    }
    this.bumpCalls.push({ kinds, ids });
    return Promise.resolve();
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────

const makeQuery = (
  text = "deployment strategy",
  kinds: QueryKind[] = [],
): Query =>
  Query.create({
    text: QueryText.create(text),
    kinds,
    tags: Tags.empty(),
    mustHaveTags: Tags.empty(),
    mustNotHaveTags: Tags.empty(),
    includeSuperseded: false,
  });

const makeFilters = (limit = 10): RecallFilters =>
  RecallFilters.create({
    kinds: [],
    tags: Tags.empty(),
    mustHaveTags: Tags.empty(),
    mustNotHaveTags: Tags.empty(),
    minConfidence: null,
    since: null,
    until: null,
    limit,
  });

const projection = (over: Partial<MemoryProjection>): MemoryProjection => ({
  kind: over.kind ?? "decision",
  id: over.id ?? "01952f3b-7d8c-7000-8000-aaaaaaaaaaaa",
  title: over.title ?? "Choose Postgres",
  preview: over.preview ?? "We picked Postgres because of JSONB support.",
  tags: over.tags ?? Tags.empty(),
  confidence: over.confidence ?? Confidence.full(),
  useCount: over.useCount ?? UseCount.zero(),
  lastUsedAt: over.lastUsedAt ?? LastUsed.at(Timestamp.fromEpochMs(ANCHOR_TIME_MS)),
  createdAt: over.createdAt ?? Timestamp.fromEpochMs(ANCHOR_TIME_MS),
  severity: over.severity ?? null,
});

// ─── Setup ─────────────────────────────────────────────────────────────

let lexical: StubLexical;
let vector: StubVector;
let embedder: StubEmbedder;
let projections: StubProjections;
let tokenCounter: StubTokenCounter;
let clock: FakeClock;
let useCase: RecallMemoryUseCase;

beforeEach(() => {
  lexical = new StubLexical();
  vector = new StubVector();
  embedder = new StubEmbedder();
  projections = new StubProjections();
  tokenCounter = new StubTokenCounter();
  clock = new FakeClock({ initialMs: ANCHOR_TIME_MS });
  useCase = new RecallMemoryUseCase(
    embedder,
    lexical,
    vector,
    projections,
    tokenCounter,
    clock,
    new SilentLogger(),
  );
});

const ID_A = "01952f3b-7d8c-7000-8000-aaaaaaaaaa01";
const ID_B = "01952f3b-7d8c-7000-8000-aaaaaaaaaa02";

describe("RecallMemoryUseCase.recall", () => {
  it("returns an empty result when query is null (filter-only path)", async () => {
    const result = await useCase.recall({
      workspaceId: makeWorkspaceId(),
      query: null,
      filters: makeFilters(),
      maxTokens: TokenBudget.withMax(1000),
      weights: RelevanceWeights.defaults(),
    });

    expect(result.getEntries().length).toBe(0);
    expect(result.totalCandidates).toBe(0);
    expect(result.totalTokens.toNumber()).toBe(0);
    expect(result.fallbackReason).toBeNull();
    expect(lexical.calls).toBe(0);
    expect(vector.calls).toBe(0);
    expect(embedder.callCount).toBe(0);
  });

  it("merges lexical + vector hits and ranks via HybridScorer", async () => {
    lexical.hits = [{ kind: "decision", id: ID_A, score: BM25Score.of(2.0) }];
    vector.hits = [
      { kind: "decision", id: ID_A, score: CosineScore.of(0.9) },
      { kind: "learning", id: ID_B, score: CosineScore.of(0.7) },
    ];
    projections.projections = [
      projection({ kind: "decision", id: ID_A, title: "A" }),
      projection({
        kind: "learning",
        id: ID_B,
        title: "B",
        preview: "leak detected",
        severity: LearningSeverity.tip(),
      }),
    ];

    const result = await useCase.recall({
      workspaceId: makeWorkspaceId(),
      query: makeQuery(),
      filters: makeFilters(),
      maxTokens: TokenBudget.withMax(1000),
      weights: RelevanceWeights.defaults(),
    });

    expect(result.totalCandidates).toBe(2);
    expect(result.fallbackReason).toBeNull();
    const entries = result.getEntries();
    // Both ranked entries should appear; both have fully-populated scores.
    expect(entries.length).toBe(2);
    // The decision has both BM25 + cosine hits, so it must outrank the learning.
    expect(entries[0]?.kind.value).toBe("decision");
    expect(entries[0]?.bm25Score).not.toBeNull();
    expect(entries[0]?.cosineScore).not.toBeNull();
  });

  it("reports embedder_unavailable when the embedder throws", async () => {
    embedder.error = new Error("model load failed");
    lexical.hits = [{ kind: "decision", id: ID_A, score: BM25Score.of(1.5) }];
    projections.projections = [projection({ kind: "decision", id: ID_A })];

    const result = await useCase.recall({
      workspaceId: makeWorkspaceId(),
      query: makeQuery(),
      filters: makeFilters(),
      maxTokens: TokenBudget.withMax(1000),
      weights: RelevanceWeights.defaults(),
    });

    expect(result.fallbackReason).toBe("embedder_unavailable");
    expect(result.getEntries().length).toBe(1);
    expect(result.getEntries()[0]?.cosineScore).toBeNull();
  });

  it("reports embedder_unavailable when the vector search itself throws", async () => {
    vector.error = new Error("vec0 not loaded");
    lexical.hits = [{ kind: "decision", id: ID_A, score: BM25Score.of(1.5) }];
    projections.projections = [projection({ kind: "decision", id: ID_A })];

    const result = await useCase.recall({
      workspaceId: makeWorkspaceId(),
      query: makeQuery(),
      filters: makeFilters(),
      maxTokens: TokenBudget.withMax(1000),
      weights: RelevanceWeights.defaults(),
    });

    expect(result.fallbackReason).toBe("embedder_unavailable");
  });

  it("reports no_embeddings_yet when embedder is OK but vector returns 0 hits", async () => {
    lexical.hits = [{ kind: "decision", id: ID_A, score: BM25Score.of(1.0) }];
    vector.hits = [];
    projections.projections = [projection({ kind: "decision", id: ID_A })];

    const result = await useCase.recall({
      workspaceId: makeWorkspaceId(),
      query: makeQuery(),
      filters: makeFilters(),
      maxTokens: TokenBudget.withMax(1000),
      weights: RelevanceWeights.defaults(),
    });

    expect(result.fallbackReason).toBe("no_embeddings_yet");
  });

  it("returns no fallback when both signals contribute candidates", async () => {
    lexical.hits = [{ kind: "decision", id: ID_A, score: BM25Score.of(1.0) }];
    vector.hits = [{ kind: "decision", id: ID_A, score: CosineScore.of(0.8) }];
    projections.projections = [projection({ kind: "decision", id: ID_A })];

    const result = await useCase.recall({
      workspaceId: makeWorkspaceId(),
      query: makeQuery(),
      filters: makeFilters(),
      maxTokens: TokenBudget.withMax(1000),
      weights: RelevanceWeights.defaults(),
    });

    expect(result.fallbackReason).toBeNull();
  });

  it("survives a lexical search failure (degrades to vector-only)", async () => {
    lexical.error = new Error("FTS5 broken");
    vector.hits = [{ kind: "decision", id: ID_A, score: CosineScore.of(0.9) }];
    projections.projections = [projection({ kind: "decision", id: ID_A })];

    const result = await useCase.recall({
      workspaceId: makeWorkspaceId(),
      query: makeQuery(),
      filters: makeFilters(),
      maxTokens: TokenBudget.withMax(1000),
      weights: RelevanceWeights.defaults(),
    });

    expect(result.getEntries().length).toBe(1);
    expect(result.fallbackReason).toBeNull();
  });

  it("returns an empty result with no fallback when no signal hits", async () => {
    lexical.hits = [];
    vector.hits = [];
    const result = await useCase.recall({
      workspaceId: makeWorkspaceId(),
      query: makeQuery(),
      filters: makeFilters(),
      maxTokens: TokenBudget.withMax(1000),
      weights: RelevanceWeights.defaults(),
    });
    expect(result.getEntries().length).toBe(0);
    expect(result.totalCandidates).toBe(0);
    expect(result.fallbackReason).toBeNull();
  });

  it("respects the filters.limit slice", async () => {
    const ids: string[] = [];
    const projs: MemoryProjection[] = [];
    const lex: LexicalSearchHit[] = [];
    for (let i = 0; i < 5; i += 1) {
      const id = `01952f3b-7d8c-7000-8000-${"0".repeat(11)}${i + 1}`;
      ids.push(id);
      projs.push(projection({ kind: "decision", id }));
      lex.push({ kind: "decision", id, score: BM25Score.of(1 - i * 0.1) });
    }
    lexical.hits = lex;
    projections.projections = projs;

    const result = await useCase.recall({
      workspaceId: makeWorkspaceId(),
      query: makeQuery(),
      filters: makeFilters(2),
      maxTokens: TokenBudget.withMax(10000),
      weights: RelevanceWeights.defaults(),
    });

    expect(result.getEntries().length).toBe(2);
    expect(result.totalCandidates).toBe(5);
  });

  it("trims the tail when the cumulative token cost would exceed maxTokens", async () => {
    const longTitle = "X".repeat(400);
    const longPreview = "Y".repeat(400);
    const projs: MemoryProjection[] = [];
    const lex: LexicalSearchHit[] = [];
    for (let i = 0; i < 5; i += 1) {
      const id = `01952f3b-7d8c-7000-8000-${"0".repeat(11)}${i + 1}`;
      projs.push(
        projection({
          kind: "decision",
          id,
          title: longTitle,
          preview: longPreview,
        }),
      );
      lex.push({ kind: "decision", id, score: BM25Score.of(1 - i * 0.05) });
    }
    lexical.hits = lex;
    projections.projections = projs;

    const result = await useCase.recall({
      workspaceId: makeWorkspaceId(),
      query: makeQuery(),
      filters: makeFilters(10),
      maxTokens: TokenBudget.withMax(250),
      weights: RelevanceWeights.defaults(),
    });

    // Each entry is ~200 tokens (title 400 + "\n" + preview 400 = 801
    // chars / 4). Budget is 250. Top-ranked hit is always included
    // (B-MCP-8 guarantee), and the next would put cumulative over 250
    // (200 + 200 = 400 > 250) so the rest are skipped via `continue`.
    expect(result.getEntries().length).toBe(1);
    expect(result.getEntries()[0]?.id).toBe(
      "01952f3b-7d8c-7000-8000-000000000001",
    );
  });

  it("always includes the top-ranked hit even when it solo exceeds maxTokens (B-MCP-8)", async () => {
    // Reproduces the bug observed against the dogfood DB on
    // `@netzi/recall@0.1.2-beta.4`: a query found `total_candidates>0`
    // but the recall returned zero hits because the top-ranked
    // candidate's preview alone was larger than the default token
    // budget. The token counter here is `len/4`, so an 8000-character
    // entry costs 2000 tokens — twice the 1000-token budget below.
    const huge = "Z".repeat(4000);
    const tiny = "ok";
    projections.projections = [
      projection({ kind: "decision", id: ID_A, title: huge, preview: huge }),
      projection({ kind: "decision", id: ID_B, title: tiny, preview: tiny }),
    ];
    lexical.hits = [
      { kind: "decision", id: ID_A, score: BM25Score.of(2.0) },
      { kind: "decision", id: ID_B, score: BM25Score.of(0.5) },
    ];

    const result = await useCase.recall({
      workspaceId: makeWorkspaceId(),
      query: makeQuery(),
      filters: makeFilters(5),
      maxTokens: TokenBudget.withMax(1000),
      weights: RelevanceWeights.defaults(),
    });

    expect(result.totalCandidates).toBe(2);
    const entries = result.getEntries();
    // The top-ranked hit must come back even though it alone exceeds
    // the budget — returning zero hits when there ARE candidates was
    // exactly the regression behaviour reported in B-MCP-8. Subsequent
    // hits are not expected to fit here because the top hit's tokens
    // already drove `runningTokens` past the budget; the second test
    // ("skips a mid-ranking oversized hit ...") covers the
    // continue-vs-break case where the top hit DOES fit and a mid
    // candidate is the one that overflows.
    expect(entries.length).toBe(1);
    expect(entries[0]?.id).toBe(ID_A);
  });

  it("skips a mid-ranking oversized hit and still includes smaller ones behind it (B-MCP-8)", async () => {
    // Three candidates ranked by BM25:
    //   1. ID_A  — small (fits)
    //   2. ID_B  — huge (does NOT fit on its own AFTER ID_A)
    //   3. ID_C  — small (would still fit if we don't `break` on ID_B)
    // The pre-fix `break` semantics returned only [ID_A]; the fix uses
    // `continue` so ID_C surfaces too.
    const ID_C = "01952f3b-7d8c-7000-8000-aaaaaaaaaa03";
    const huge = "Z".repeat(8000); // 8001 chars → ~2001 tokens alone
    const tiny = "ok";
    projections.projections = [
      projection({ kind: "decision", id: ID_A, title: tiny, preview: tiny }),
      projection({ kind: "decision", id: ID_B, title: huge, preview: huge }),
      projection({ kind: "decision", id: ID_C, title: tiny, preview: tiny }),
    ];
    lexical.hits = [
      { kind: "decision", id: ID_A, score: BM25Score.of(3.0) },
      { kind: "decision", id: ID_B, score: BM25Score.of(2.0) },
      { kind: "decision", id: ID_C, score: BM25Score.of(1.0) },
    ];

    const result = await useCase.recall({
      workspaceId: makeWorkspaceId(),
      query: makeQuery(),
      filters: makeFilters(5),
      maxTokens: TokenBudget.withMax(500),
      weights: RelevanceWeights.defaults(),
    });

    const entries = result.getEntries();
    const ids = entries.map((e) => e.id);
    expect(ids).toContain(ID_A);
    expect(ids).toContain(ID_C);
    expect(ids).not.toContain(ID_B);
    expect(entries.length).toBe(2);
  });

  it("calls bumpUsage after a successful recall", async () => {
    lexical.hits = [{ kind: "decision", id: ID_A, score: BM25Score.of(1.5) }];
    projections.projections = [projection({ kind: "decision", id: ID_A })];

    await useCase.recall({
      workspaceId: makeWorkspaceId(),
      query: makeQuery(),
      filters: makeFilters(),
      maxTokens: TokenBudget.withMax(1000),
      weights: RelevanceWeights.defaults(),
    });

    expect(projections.bumpCalls.length).toBe(1);
    expect(projections.bumpCalls[0]?.kinds).toEqual(["decision"]);
    expect(projections.bumpCalls[0]?.ids).toEqual([ID_A]);
  });

  it("does not call bumpUsage when there are no entries", async () => {
    lexical.hits = [];
    vector.hits = [];

    await useCase.recall({
      workspaceId: makeWorkspaceId(),
      query: makeQuery(),
      filters: makeFilters(),
      maxTokens: TokenBudget.withMax(1000),
      weights: RelevanceWeights.defaults(),
    });

    expect(projections.bumpCalls).toEqual([]);
  });

  it("swallows bumpUsage errors so the recall result is unaffected", async () => {
    lexical.hits = [{ kind: "decision", id: ID_A, score: BM25Score.of(1.5) }];
    projections.projections = [projection({ kind: "decision", id: ID_A })];
    projections.bumpError = new Error("write lock");

    const result = await useCase.recall({
      workspaceId: makeWorkspaceId(),
      query: makeQuery(),
      filters: makeFilters(),
      maxTokens: TokenBudget.withMax(1000),
      weights: RelevanceWeights.defaults(),
    });

    expect(result.getEntries().length).toBe(1);
  });

  it("applies a critical priority boost to learnings", async () => {
    lexical.hits = [
      { kind: "learning", id: ID_A, score: BM25Score.of(0.5) },
      { kind: "decision", id: ID_B, score: BM25Score.of(0.5) },
    ];
    projections.projections = [
      projection({
        kind: "learning",
        id: ID_A,
        severity: LearningSeverity.critical(),
      }),
      projection({ kind: "decision", id: ID_B }),
    ];

    const result = await useCase.recall({
      workspaceId: makeWorkspaceId(),
      query: makeQuery(),
      filters: makeFilters(),
      maxTokens: TokenBudget.withMax(1000),
      weights: RelevanceWeights.defaults(),
    });

    const entries = result.getEntries();
    // Critical learning must outrank the equally-scored decision.
    expect(entries[0]?.kind.value).toBe("learning");
  });

  it("applies a warning priority boost to learnings", async () => {
    lexical.hits = [
      { kind: "learning", id: ID_A, score: BM25Score.of(0.5) },
      { kind: "decision", id: ID_B, score: BM25Score.of(0.5) },
    ];
    projections.projections = [
      projection({
        kind: "learning",
        id: ID_A,
        severity: LearningSeverity.warning(),
      }),
      projection({ kind: "decision", id: ID_B }),
    ];

    const result = await useCase.recall({
      workspaceId: makeWorkspaceId(),
      query: makeQuery(),
      filters: makeFilters(),
      maxTokens: TokenBudget.withMax(1000),
      weights: RelevanceWeights.defaults(),
    });

    expect(result.getEntries()[0]?.kind.value).toBe("learning");
  });

  it("applies no priority boost to tip-severity learnings", async () => {
    lexical.hits = [
      { kind: "learning", id: ID_A, score: BM25Score.of(0.5) },
      { kind: "decision", id: ID_B, score: BM25Score.of(1.0) },
    ];
    projections.projections = [
      projection({
        kind: "learning",
        id: ID_A,
        severity: LearningSeverity.tip(),
      }),
      projection({ kind: "decision", id: ID_B }),
    ];

    const result = await useCase.recall({
      workspaceId: makeWorkspaceId(),
      query: makeQuery(),
      filters: makeFilters(),
      maxTokens: TokenBudget.withMax(1000),
      weights: RelevanceWeights.defaults(),
    });

    // No boost, the higher-BM25 decision wins.
    expect(result.getEntries()[0]?.kind.value).toBe("decision");
  });

  it("hydrates entity, task, and turn projections (covers all queryKindOf branches)", async () => {
    lexical.hits = [
      { kind: "entity", id: ID_A, score: BM25Score.of(0.5) },
      { kind: "task", id: ID_B, score: BM25Score.of(0.5) },
    ];
    vector.hits = [
      {
        kind: "turn",
        id: "01952f3b-7d8c-7000-8000-aaaaaaaaaa03",
        score: CosineScore.of(0.5),
      },
    ];
    projections.projections = [
      projection({ kind: "entity", id: ID_A }),
      projection({ kind: "task", id: ID_B }),
      projection({
        kind: "turn",
        id: "01952f3b-7d8c-7000-8000-aaaaaaaaaa03",
      }),
    ];

    const result = await useCase.recall({
      workspaceId: makeWorkspaceId(),
      query: makeQuery(),
      filters: makeFilters(),
      maxTokens: TokenBudget.withMax(1000),
      weights: RelevanceWeights.defaults(),
    });

    const kinds = result.getEntries().map((e) => e.kind.value).sort();
    expect(kinds).toEqual(["entity", "task", "turn"]);
  });

  it("dedupes a candidate that appears in both lexical and vector results", async () => {
    lexical.hits = [{ kind: "decision", id: ID_A, score: BM25Score.of(1.0) }];
    vector.hits = [{ kind: "decision", id: ID_A, score: CosineScore.of(0.8) }];
    projections.projections = [projection({ kind: "decision", id: ID_A })];

    const result = await useCase.recall({
      workspaceId: makeWorkspaceId(),
      query: makeQuery(),
      filters: makeFilters(),
      maxTokens: TokenBudget.withMax(1000),
      weights: RelevanceWeights.defaults(),
    });

    expect(result.getEntries().length).toBe(1);
    expect(result.totalCandidates).toBe(1);
  });

  it("normalises bm25 to zero when every candidate has bm25=0", async () => {
    lexical.hits = [
      { kind: "decision", id: ID_A, score: BM25Score.zero() },
    ];
    projections.projections = [projection({ kind: "decision", id: ID_A })];

    const result = await useCase.recall({
      workspaceId: makeWorkspaceId(),
      query: makeQuery(),
      filters: makeFilters(),
      maxTokens: TokenBudget.withMax(1000),
      weights: RelevanceWeights.defaults(),
    });

    expect(result.getEntries().length).toBe(1);
    expect(result.getEntries()[0]?.bm25Score?.toNumber()).toBe(0);
  });

  it("uses LastUsed.never() projections without crashing (lastUsedAt remains null)", async () => {
    lexical.hits = [{ kind: "decision", id: ID_A, score: BM25Score.of(1.0) }];
    projections.projections = [
      projection({
        kind: "decision",
        id: ID_A,
        lastUsedAt: LastUsed.never(),
      }),
    ];

    const result = await useCase.recall({
      workspaceId: makeWorkspaceId(),
      query: makeQuery(),
      filters: makeFilters(),
      maxTokens: TokenBudget.withMax(1000),
      weights: RelevanceWeights.defaults(),
    });

    expect(result.getEntries().length).toBe(1);
    expect(result.getEntries()[0]?.lastUsedAt).toBeNull();
  });
});
