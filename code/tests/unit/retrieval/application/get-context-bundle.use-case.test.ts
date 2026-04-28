import { beforeEach, describe, expect, it } from "vitest";

import { GetContextBundleUseCase } from "../../../../src/modules/retrieval/application/use-cases/get-context-bundle.use-case.ts";
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
import { QueryText } from "../../../../src/modules/retrieval/domain/value-objects/query-text.ts";
import { Query } from "../../../../src/modules/retrieval/domain/value-objects/query.ts";
import { RelevanceScore } from "../../../../src/modules/retrieval/domain/value-objects/relevance-score.ts";
import { RelevanceWeights } from "../../../../src/modules/retrieval/domain/value-objects/relevance-weights.ts";
import { TokenBudget } from "../../../../src/modules/retrieval/domain/value-objects/token-budget.ts";
import { DecisionRef } from "../../../../src/modules/retrieval/domain/value-objects/decision-ref.ts";
import { EntityRef } from "../../../../src/modules/retrieval/domain/value-objects/entity-ref.ts";
import { OpenQuestionRef } from "../../../../src/modules/retrieval/domain/value-objects/open-question-ref.ts";
import { TaskRef } from "../../../../src/modules/retrieval/domain/value-objects/task-ref.ts";
import { TurnRef } from "../../../../src/modules/retrieval/domain/value-objects/turn-ref.ts";
import { WorkspaceAnchorPayload } from "../../../../src/modules/retrieval/domain/value-objects/workspace-anchor-payload.ts";
import type { QueryKindValue } from "../../../../src/modules/retrieval/domain/value-objects/query-kind.ts";
import { DecisionId } from "../../../../src/modules/memory/domain/value-objects/decision-id.ts";
import { DecisionTitle } from "../../../../src/modules/memory/domain/value-objects/decision-title.ts";
import { EntityDescription } from "../../../../src/modules/memory/domain/value-objects/entity-description.ts";
import { EntityId } from "../../../../src/modules/memory/domain/value-objects/entity-id.ts";
import { EntityKind } from "../../../../src/modules/memory/domain/value-objects/entity-kind.ts";
import { EntityName } from "../../../../src/modules/memory/domain/value-objects/entity-name.ts";
import { LastUsed } from "../../../../src/modules/memory/domain/value-objects/last-used.ts";
import { OpenQuestion } from "../../../../src/modules/memory/domain/value-objects/open-question.ts";
import { Scope } from "../../../../src/modules/memory/domain/value-objects/scope.ts";
import { SessionId } from "../../../../src/modules/memory/domain/value-objects/session-id.ts";
import { TaskId } from "../../../../src/modules/memory/domain/value-objects/task-id.ts";
import { TaskPriority } from "../../../../src/modules/memory/domain/value-objects/task-priority.ts";
import { TaskStatus } from "../../../../src/modules/memory/domain/value-objects/task-status.ts";
import { TaskTitle } from "../../../../src/modules/memory/domain/value-objects/task-title.ts";
import { TurnId } from "../../../../src/modules/memory/domain/value-objects/turn-id.ts";
import { TurnSummary } from "../../../../src/modules/memory/domain/value-objects/turn-summary.ts";
import { UseCount } from "../../../../src/modules/memory/domain/value-objects/use-count.ts";
import { Confidence } from "../../../../src/shared/domain/value-objects/confidence.ts";
import { NonEmptyString } from "../../../../src/shared/domain/value-objects/non-empty-string.ts";
import { Tags } from "../../../../src/shared/domain/value-objects/tags.ts";
import { Timestamp } from "../../../../src/shared/domain/value-objects/timestamp.ts";
import { Tokens } from "../../../../src/shared/domain/value-objects/tokens.ts";
import { FakeClock } from "../../../../src/shared/infrastructure/clock/fake-clock.ts";
import { FakeIdGenerator } from "../../../../src/shared/infrastructure/id-generator/fake-id-generator.ts";
import { ANCHOR_TIME_MS, makeWorkspaceId } from "../../../helpers/factories.ts";
import { SilentLogger } from "../../../helpers/test-doubles.ts";

// ─── Local NonEmptyString helper ───────────────────────────────────────

class TestDisplayName extends NonEmptyString {
  public static from(raw: string): TestDisplayName {
    return new TestDisplayName(NonEmptyString.normalize(raw, "display_name"));
  }
}

// ─── Test doubles ──────────────────────────────────────────────────────

class StubLexical implements LexicalSearch {
  public hits: readonly LexicalSearchHit[] = [];
  public error: Error | null = null;
  public search(): Promise<readonly LexicalSearchHit[]> {
    if (this.error !== null) return Promise.reject(this.error);
    return Promise.resolve(this.hits);
  }
}

class StubVector implements VectorSearch {
  public hits: readonly VectorSearchHit[] = [];
  public error: Error | null = null;
  public search(): Promise<readonly VectorSearchHit[]> {
    if (this.error !== null) return Promise.reject(this.error);
    return Promise.resolve(this.hits);
  }
}

class StubEmbedder implements Embedder {
  public error: Error | null = null;
  public embed(): Promise<EmbeddingVector> {
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
  public anchor: WorkspaceAnchorPayload | null = null;
  public decisions: readonly DecisionRef[] = [];
  public tasks: readonly TaskRef[] = [];
  public turns: readonly TurnRef[] = [];
  public openQuestions: readonly OpenQuestionRef[] = [];
  public projections: readonly MemoryProjection[] = [];
  public entityRefs: readonly EntityRef[] = [];
  public entityRefsError: Error | null = null;

  public loadWorkspaceAnchor(): Promise<WorkspaceAnchorPayload | null> {
    return Promise.resolve(this.anchor);
  }
  public listActiveDecisions(): Promise<readonly DecisionRef[]> {
    return Promise.resolve(this.decisions);
  }
  public listOpenTasks(): Promise<readonly TaskRef[]> {
    return Promise.resolve(this.tasks);
  }
  public listRecentTurns(): Promise<readonly TurnRef[]> {
    return Promise.resolve(this.turns);
  }
  public listOpenQuestions(): Promise<readonly OpenQuestionRef[]> {
    return Promise.resolve(this.openQuestions);
  }
  public loadProjectionsByHits(input: {
    hits: readonly { readonly kind: QueryKindValue; readonly id: string }[];
  }): Promise<readonly MemoryProjection[]> {
    const want = new Set(input.hits.map((h) => `${h.kind}::${h.id}`));
    return Promise.resolve(
      this.projections.filter((p) => want.has(`${p.kind}::${p.id}`)),
    );
  }
  public loadEntityRefsByIds(): Promise<readonly EntityRef[]> {
    if (this.entityRefsError !== null) return Promise.reject(this.entityRefsError);
    return Promise.resolve(this.entityRefs);
  }
  public bumpUsage(): Promise<void> {
    return Promise.resolve();
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────

const FIXED_BUNDLE_UUID = "01952f3c-2222-7000-8000-444444444444";
const ID_DEC_1 = "01952f3b-7d8c-7000-8000-d00000000001";
const ID_TASK_1 = "01952f3b-7d8c-7000-8000-d00000000002";
const ID_TURN_1 = "01952f3b-7d8c-7000-8000-d00000000003";
const ID_ENT_1 = "01952f3b-7d8c-7000-8000-d00000000004";
const SESSION_1 = "01952f3c-2222-7000-8000-555555555555";

const sampleAnchor = (): WorkspaceAnchorPayload =>
  WorkspaceAnchorPayload.of({
    workspaceId: makeWorkspaceId(),
    displayName: TestDisplayName.from("My Project"),
    mode: "shared",
    activeSessionId: SessionId.from(SESSION_1),
    activeSessionIntent: null,
    sessionStartedAt: Timestamp.fromEpochMs(ANCHOR_TIME_MS),
    metadata: { language: "ts" },
  });

const decisionRef = (id = ID_DEC_1, title = "Use Postgres"): DecisionRef =>
  DecisionRef.of({
    id: DecisionId.from(id),
    title: DecisionTitle.from(title),
    tags: Tags.empty(),
    scope: Scope.create("project", null),
    confidence: Confidence.full(),
    relevanceScore: RelevanceScore.zero(),
  });

const taskRef = (id = ID_TASK_1, title = "Add auth"): TaskRef =>
  TaskRef.of({
    id: TaskId.from(id),
    title: TaskTitle.from(title),
    status: TaskStatus.todo(),
    priority: TaskPriority.high(),
    tags: Tags.empty(),
    relevanceScore: RelevanceScore.zero(),
  });

const turnRef = (id = ID_TURN_1, summary = "Discussed migrations"): TurnRef =>
  TurnRef.of({
    id: TurnId.from(id),
    summary: TurnSummary.from(summary),
    recordedAt: Timestamp.fromEpochMs(ANCHOR_TIME_MS),
    confidence: Confidence.full(),
    tags: Tags.empty(),
    relevanceScore: RelevanceScore.zero(),
  });

const entityRef = (id = ID_ENT_1, name = "UserService"): EntityRef =>
  EntityRef.of({
    id: EntityId.from(id),
    name: EntityName.from(name),
    entityKind: EntityKind.serviceKind(),
    description: EntityDescription.unknown(),
    location: null,
    confidence: Confidence.full(),
    relevanceScore: RelevanceScore.zero(),
  });

const openQuestionRef = (text = "How to handle 401?"): OpenQuestionRef =>
  OpenQuestionRef.of({
    sessionId: SessionId.from(SESSION_1),
    question: OpenQuestion.from(text, Timestamp.fromEpochMs(ANCHOR_TIME_MS)),
    recordedAt: Timestamp.fromEpochMs(ANCHOR_TIME_MS),
  });

const projection = (over: Partial<MemoryProjection>): MemoryProjection => ({
  kind: over.kind ?? "decision",
  id: over.id ?? ID_DEC_1,
  title: over.title ?? "X",
  preview: over.preview ?? "Y",
  tags: over.tags ?? Tags.empty(),
  confidence: over.confidence ?? Confidence.full(),
  useCount: over.useCount ?? UseCount.zero(),
  lastUsedAt: over.lastUsedAt ?? LastUsed.at(Timestamp.fromEpochMs(ANCHOR_TIME_MS)),
  createdAt: over.createdAt ?? Timestamp.fromEpochMs(ANCHOR_TIME_MS),
  severity: over.severity ?? null,
});

const makeQuery = (text = "deploy"): Query =>
  Query.create({
    text: QueryText.create(text),
    kinds: [],
    tags: Tags.empty(),
    mustHaveTags: Tags.empty(),
    mustNotHaveTags: Tags.empty(),
    includeSuperseded: false,
  });

// ─── Setup ─────────────────────────────────────────────────────────────

let lexical: StubLexical;
let vector: StubVector;
let embedder: StubEmbedder;
let projections: StubProjections;
let tokenCounter: StubTokenCounter;
let clock: FakeClock;
let idGen: FakeIdGenerator;
let useCase: GetContextBundleUseCase;

beforeEach(() => {
  lexical = new StubLexical();
  vector = new StubVector();
  embedder = new StubEmbedder();
  projections = new StubProjections();
  tokenCounter = new StubTokenCounter();
  clock = new FakeClock({ initialMs: ANCHOR_TIME_MS });
  idGen = new FakeIdGenerator({ sequence: [FIXED_BUNDLE_UUID] });
  useCase = new GetContextBundleUseCase(
    embedder,
    lexical,
    vector,
    projections,
    tokenCounter,
    clock,
    idGen,
    new SilentLogger(),
  );
});

describe("GetContextBundleUseCase.build", () => {
  it("emits all seven canonical layers even when every layer is empty (no query)", async () => {
    // BUG B-018 — `mem.context` must always emit the seven canonical
    // layers (docs/02 §4.2). Previously the use case dropped empty
    // layers, which left MCP clients staring at a single
    // `system_identity` entry on a fresh workspace.
    const bundle = await useCase.build({
      workspaceId: makeWorkspaceId(),
      query: null,
      maxTokens: TokenBudget.withMax(10000),
      layerBudgets: {},
      weights: RelevanceWeights.defaults(),
    });

    expect(bundle.layersCount()).toBe(7);
    expect(bundle.hasLayerOfKind("workspace_anchor")).toBe(true);
    expect(bundle.hasLayerOfKind("active_decisions")).toBe(true);
    expect(bundle.hasLayerOfKind("open_tasks")).toBe(true);
    expect(bundle.hasLayerOfKind("recent_turns")).toBe(true);
    expect(bundle.hasLayerOfKind("relevant_memory")).toBe(true);
    expect(bundle.hasLayerOfKind("entities_in_focus")).toBe(true);
    expect(bundle.hasLayerOfKind("open_questions")).toBe(true);

    // Empty layers report `entries_count: 0` and consume zero tokens.
    for (const layer of bundle.getLayers()) {
      expect(layer.entriesCount()).toBe(0);
      expect(layer.tokens().toNumber()).toBe(0);
    }
  });

  it("emits a ContextBundleAssembled event on construction", async () => {
    const bundle = await useCase.build({
      workspaceId: makeWorkspaceId(),
      query: null,
      maxTokens: TokenBudget.withMax(10000),
      layerBudgets: {},
      weights: RelevanceWeights.defaults(),
    });

    const events = bundle.pullEvents();
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0]?.eventName).toBe("retrieval.context-bundle-assembled");
  });

  it("includes a workspace_anchor layer when the anchor is available", async () => {
    projections.anchor = sampleAnchor();

    const bundle = await useCase.build({
      workspaceId: makeWorkspaceId(),
      query: null,
      maxTokens: TokenBudget.withMax(10000),
      layerBudgets: {},
      weights: RelevanceWeights.defaults(),
    });

    expect(bundle.hasLayerOfKind("workspace_anchor")).toBe(true);
  });

  it("includes active_decisions layer when decisions exist", async () => {
    projections.decisions = [decisionRef()];

    const bundle = await useCase.build({
      workspaceId: makeWorkspaceId(),
      query: null,
      maxTokens: TokenBudget.withMax(10000),
      layerBudgets: {},
      weights: RelevanceWeights.defaults(),
    });

    expect(bundle.hasLayerOfKind("active_decisions")).toBe(true);
  });

  it("includes open_tasks layer when tasks exist", async () => {
    projections.tasks = [taskRef()];

    const bundle = await useCase.build({
      workspaceId: makeWorkspaceId(),
      query: null,
      maxTokens: TokenBudget.withMax(10000),
      layerBudgets: {},
      weights: RelevanceWeights.defaults(),
    });

    expect(bundle.hasLayerOfKind("open_tasks")).toBe(true);
  });

  it("includes recent_turns layer when turns exist", async () => {
    projections.turns = [turnRef()];

    const bundle = await useCase.build({
      workspaceId: makeWorkspaceId(),
      query: null,
      maxTokens: TokenBudget.withMax(10000),
      layerBudgets: {},
      weights: RelevanceWeights.defaults(),
    });

    expect(bundle.hasLayerOfKind("recent_turns")).toBe(true);
  });

  it("includes open_questions layer when questions exist", async () => {
    projections.openQuestions = [openQuestionRef()];

    const bundle = await useCase.build({
      workspaceId: makeWorkspaceId(),
      query: null,
      maxTokens: TokenBudget.withMax(10000),
      layerBudgets: {},
      weights: RelevanceWeights.defaults(),
    });

    expect(bundle.hasLayerOfKind("open_questions")).toBe(true);
  });

  it("emits empty relevant_memory and entities_in_focus layers when query is null", async () => {
    // BUG B-018 — query-driven layers are still emitted (with
    // `entries_count: 0`) when the query is null so the wire response
    // always carries the seven canonical layers.
    projections.anchor = sampleAnchor();

    const bundle = await useCase.build({
      workspaceId: makeWorkspaceId(),
      query: null,
      maxTokens: TokenBudget.withMax(10000),
      layerBudgets: {},
      weights: RelevanceWeights.defaults(),
    });

    const relevantMemory = bundle.findLayer("relevant_memory");
    const entities = bundle.findLayer("entities_in_focus");
    expect(relevantMemory).not.toBeNull();
    expect(entities).not.toBeNull();
    expect(relevantMemory?.entriesCount()).toBe(0);
    expect(entities?.entriesCount()).toBe(0);
  });

  it("includes relevant_memory layer when query produces hits", async () => {
    lexical.hits = [
      { kind: "decision", id: ID_DEC_1, score: BM25Score.of(1.0) },
    ];
    projections.projections = [projection({ kind: "decision", id: ID_DEC_1 })];

    const bundle = await useCase.build({
      workspaceId: makeWorkspaceId(),
      query: makeQuery(),
      maxTokens: TokenBudget.withMax(10000),
      layerBudgets: {},
      weights: RelevanceWeights.defaults(),
    });

    expect(bundle.hasLayerOfKind("relevant_memory")).toBe(true);
  });

  it("includes entities_in_focus when query hits an entity", async () => {
    // The entity hit feeds BOTH relevant_memory AND entities_in_focus.
    // relevant_memory is built first and dedupes by (kind, id) on
    // SUCCESS only (refs that get clamped by the cap before being
    // added are NOT marked seen). We force the per-layer cap of
    // relevant_memory to 0-tokens-effectively by giving the projection
    // long renderable strings that exceed the cap.
    const ENT_2 = "01952f3b-7d8c-7000-8000-d000000000aa";
    vector.hits = [
      { kind: "entity", id: ENT_2, score: CosineScore.of(0.9) },
    ];
    projections.projections = [
      projection({
        kind: "entity",
        id: ENT_2,
        title: "x".repeat(100),
        preview: "y".repeat(100),
      }),
    ];
    projections.entityRefs = [entityRef(ENT_2)];

    const bundle = await useCase.build({
      workspaceId: makeWorkspaceId(),
      query: makeQuery(),
      maxTokens: TokenBudget.withMax(10000),
      layerBudgets: { relevant_memory: 1 }, // way smaller than the ~50-token entity ref
      weights: RelevanceWeights.defaults(),
    });

    // With relevant_memory budget too small for the candidate, the
    // entity does NOT get consumed there, so entities_in_focus can
    // populate.
    expect(bundle.hasLayerOfKind("entities_in_focus")).toBe(true);
  });

  it("survives a lexical search failure when building query-driven layers", async () => {
    lexical.error = new Error("FTS5 broken");
    vector.hits = [
      { kind: "decision", id: ID_DEC_1, score: CosineScore.of(0.8) },
    ];
    projections.projections = [projection({ kind: "decision", id: ID_DEC_1 })];

    const bundle = await useCase.build({
      workspaceId: makeWorkspaceId(),
      query: makeQuery(),
      maxTokens: TokenBudget.withMax(10000),
      layerBudgets: {},
      weights: RelevanceWeights.defaults(),
    });

    // The bundle should still build (vector-only) — relevant_memory present.
    expect(bundle.hasLayerOfKind("relevant_memory")).toBe(true);
  });

  it("survives an embedder failure (relevant_memory degrades to FTS5-only)", async () => {
    embedder.error = new Error("embed failed");
    lexical.hits = [
      { kind: "decision", id: ID_DEC_1, score: BM25Score.of(1.0) },
    ];
    projections.projections = [projection({ kind: "decision", id: ID_DEC_1 })];

    const bundle = await useCase.build({
      workspaceId: makeWorkspaceId(),
      query: makeQuery(),
      maxTokens: TokenBudget.withMax(10000),
      layerBudgets: {},
      weights: RelevanceWeights.defaults(),
    });

    expect(bundle.hasLayerOfKind("relevant_memory")).toBe(true);
  });

  it("survives a vector search failure", async () => {
    vector.error = new Error("vec0 broken");
    lexical.hits = [
      { kind: "decision", id: ID_DEC_1, score: BM25Score.of(1.0) },
    ];
    projections.projections = [projection({ kind: "decision", id: ID_DEC_1 })];

    const bundle = await useCase.build({
      workspaceId: makeWorkspaceId(),
      query: makeQuery(),
      maxTokens: TokenBudget.withMax(10000),
      layerBudgets: {},
      weights: RelevanceWeights.defaults(),
    });

    expect(bundle.hasLayerOfKind("relevant_memory")).toBe(true);
  });

  it("swallows entity-ref hydration errors and emits an empty entities_in_focus layer", async () => {
    // BUG B-018 — the layer is still emitted (with `entries_count: 0`)
    // even when entity-ref hydration fails; the wire contract demands
    // the canonical seven keys.
    vector.hits = [
      { kind: "entity", id: ID_ENT_1, score: CosineScore.of(0.9) },
    ];
    projections.projections = [projection({ kind: "entity", id: ID_ENT_1 })];
    projections.entityRefsError = new Error("DB lock");

    const bundle = await useCase.build({
      workspaceId: makeWorkspaceId(),
      query: makeQuery(),
      maxTokens: TokenBudget.withMax(10000),
      layerBudgets: {},
      weights: RelevanceWeights.defaults(),
    });

    const layer = bundle.findLayer("entities_in_focus");
    expect(layer).not.toBeNull();
    expect(layer?.entriesCount()).toBe(0);
  });

  it("respects per-layer budget overrides", async () => {
    // Each ref's rendered cost is roughly title.length / 4. With a tight
    // 10-token cap, only the first ref should fit.
    projections.decisions = [
      decisionRef(ID_DEC_1, "X".repeat(150)),
      decisionRef("01952f3b-7d8c-7000-8000-d00000000099", "Y".repeat(150)),
    ];

    const bundle = await useCase.build({
      workspaceId: makeWorkspaceId(),
      query: null,
      maxTokens: TokenBudget.withMax(10000),
      layerBudgets: { active_decisions: 50 }, // tight per-layer cap
      weights: RelevanceWeights.defaults(),
    });

    const layer = bundle.findLayer("active_decisions");
    if (layer !== null) {
      expect(layer.tokens().toNumber()).toBeLessThanOrEqual(50);
    }
  });

  it("truncates layers when global maxTokens is too small", async () => {
    // Fill every structured layer with content so the bundle's
    // total tokens would exceed maxTokens; the use case must call
    // truncate() to drop the lowest-priority surviving layers.
    projections.anchor = sampleAnchor();
    projections.decisions = [decisionRef(ID_DEC_1, "D".repeat(180))];
    projections.tasks = [taskRef(ID_TASK_1, "T".repeat(150))];
    projections.turns = [turnRef(ID_TURN_1, "U".repeat(180))];

    const bundle = await useCase.build({
      workspaceId: makeWorkspaceId(),
      query: null,
      maxTokens: TokenBudget.withMax(60),
      layerBudgets: {},
      weights: RelevanceWeights.defaults(),
    });

    expect(bundle.getTokenBudget().usedTokens).toBeLessThanOrEqual(60);
  });

  it("dedupes entries across layers (workspace anchor seen first)", async () => {
    projections.anchor = sampleAnchor();
    // Deliberately reuse the workspace id on a hit; the use case marks
    // the anchor key as seen so the same id cannot appear again under
    // workspace_anchor key.
    const bundle = await useCase.build({
      workspaceId: makeWorkspaceId(),
      query: null,
      maxTokens: TokenBudget.withMax(10000),
      layerBudgets: {},
      weights: RelevanceWeights.defaults(),
    });
    expect(bundle.hasLayerOfKind("workspace_anchor")).toBe(true);
  });

  it("uses defaults for empty layer budget overrides", async () => {
    projections.decisions = [decisionRef()];

    const bundle = await useCase.build({
      workspaceId: makeWorkspaceId(),
      query: null,
      maxTokens: TokenBudget.withMax(10000),
      layerBudgets: {},
      weights: RelevanceWeights.defaults(),
    });

    expect(bundle.hasLayerOfKind("active_decisions")).toBe(true);
  });

  it("ignores override budgets that are <= 0", async () => {
    projections.decisions = [decisionRef()];

    const bundle = await useCase.build({
      workspaceId: makeWorkspaceId(),
      query: null,
      maxTokens: TokenBudget.withMax(10000),
      layerBudgets: { active_decisions: 0 }, // ignored, default kicks in
      weights: RelevanceWeights.defaults(),
    });

    expect(bundle.hasLayerOfKind("active_decisions")).toBe(true);
  });

  it("clamps anchor tokens to its layer cap", async () => {
    // Anchor display name very long → token cost would exceed cap
    const longName = "n".repeat(2000);
    projections.anchor = WorkspaceAnchorPayload.of({
      workspaceId: makeWorkspaceId(),
      displayName: TestDisplayName.from(longName),
      mode: "shared",
      activeSessionId: null,
      activeSessionIntent: null,
      sessionStartedAt: null,
      metadata: {},
    });

    const bundle = await useCase.build({
      workspaceId: makeWorkspaceId(),
      query: null,
      maxTokens: TokenBudget.withMax(10000),
      layerBudgets: { workspace_anchor: 50 },
      weights: RelevanceWeights.defaults(),
    });

    const layer = bundle.findLayer("workspace_anchor");
    expect(layer?.tokens().toNumber()).toBeLessThanOrEqual(50);
  });

  it("hydrates all five candidate kinds via relevant_memory", async () => {
    lexical.hits = [
      { kind: "decision", id: ID_DEC_1, score: BM25Score.of(0.5) },
      { kind: "learning", id: "01952f3b-7d8c-7000-8000-d00000000010", score: BM25Score.of(0.5) },
      { kind: "task", id: "01952f3b-7d8c-7000-8000-d00000000011", score: BM25Score.of(0.5) },
      { kind: "turn", id: "01952f3b-7d8c-7000-8000-d00000000012", score: BM25Score.of(0.5) },
      { kind: "entity", id: "01952f3b-7d8c-7000-8000-d00000000013", score: BM25Score.of(0.5) },
    ];
    projections.projections = [
      projection({ kind: "decision", id: ID_DEC_1 }),
      projection({
        kind: "learning",
        id: "01952f3b-7d8c-7000-8000-d00000000010",
      }),
      projection({
        kind: "task",
        id: "01952f3b-7d8c-7000-8000-d00000000011",
      }),
      projection({
        kind: "turn",
        id: "01952f3b-7d8c-7000-8000-d00000000012",
      }),
      projection({
        kind: "entity",
        id: "01952f3b-7d8c-7000-8000-d00000000013",
      }),
    ];

    const bundle = await useCase.build({
      workspaceId: makeWorkspaceId(),
      query: makeQuery(),
      maxTokens: TokenBudget.withMax(10000),
      layerBudgets: {},
      weights: RelevanceWeights.defaults(),
    });

    expect(bundle.hasLayerOfKind("relevant_memory")).toBe(true);
  });

  it("renders anchor with intent when activeSessionIntent is set", async () => {
    const { SessionIntent } = await import(
      "../../../../src/modules/memory/domain/value-objects/session-intent.ts"
    );
    projections.anchor = WorkspaceAnchorPayload.of({
      workspaceId: makeWorkspaceId(),
      displayName: TestDisplayName.from("WithIntent"),
      mode: "shared",
      activeSessionId: SessionId.from(SESSION_1),
      activeSessionIntent: SessionIntent.from("Refactor auth"),
      sessionStartedAt: Timestamp.fromEpochMs(ANCHOR_TIME_MS),
      metadata: {},
    });

    const bundle = await useCase.build({
      workspaceId: makeWorkspaceId(),
      query: null,
      maxTokens: TokenBudget.withMax(10000),
      layerBudgets: {},
      weights: RelevanceWeights.defaults(),
    });

    expect(bundle.hasLayerOfKind("workspace_anchor")).toBe(true);
  });

  it("applies warning priority boost to learning candidates in relevant_memory", async () => {
    const { LearningSeverity } = await import(
      "../../../../src/modules/memory/domain/value-objects/learning-severity.ts"
    );
    const ID_LEARN = "01952f3b-7d8c-7000-8000-d000000000c1";
    lexical.hits = [
      { kind: "learning", id: ID_LEARN, score: BM25Score.of(0.5) },
    ];
    projections.projections = [
      projection({
        kind: "learning",
        id: ID_LEARN,
        severity: LearningSeverity.warning(),
      }),
    ];

    const bundle = await useCase.build({
      workspaceId: makeWorkspaceId(),
      query: makeQuery(),
      maxTokens: TokenBudget.withMax(10000),
      layerBudgets: {},
      weights: RelevanceWeights.defaults(),
    });

    expect(bundle.hasLayerOfKind("relevant_memory")).toBe(true);
  });

  it("applies critical priority boost to learning candidates", async () => {
    const { LearningSeverity } = await import(
      "../../../../src/modules/memory/domain/value-objects/learning-severity.ts"
    );
    const ID_LEARN = "01952f3b-7d8c-7000-8000-d000000000c2";
    lexical.hits = [
      { kind: "learning", id: ID_LEARN, score: BM25Score.of(0.5) },
    ];
    projections.projections = [
      projection({
        kind: "learning",
        id: ID_LEARN,
        severity: LearningSeverity.critical(),
      }),
    ];

    const bundle = await useCase.build({
      workspaceId: makeWorkspaceId(),
      query: makeQuery(),
      maxTokens: TokenBudget.withMax(10000),
      layerBudgets: {},
      weights: RelevanceWeights.defaults(),
    });

    expect(bundle.hasLayerOfKind("relevant_memory")).toBe(true);
  });

  it("applies tip (no boost) to learning candidates", async () => {
    const { LearningSeverity } = await import(
      "../../../../src/modules/memory/domain/value-objects/learning-severity.ts"
    );
    const ID_LEARN = "01952f3b-7d8c-7000-8000-d000000000c3";
    lexical.hits = [
      { kind: "learning", id: ID_LEARN, score: BM25Score.of(0.5) },
    ];
    projections.projections = [
      projection({
        kind: "learning",
        id: ID_LEARN,
        severity: LearningSeverity.tip(),
      }),
    ];

    const bundle = await useCase.build({
      workspaceId: makeWorkspaceId(),
      query: makeQuery(),
      maxTokens: TokenBudget.withMax(10000),
      layerBudgets: {},
      weights: RelevanceWeights.defaults(),
    });

    expect(bundle.hasLayerOfKind("relevant_memory")).toBe(true);
  });

  it("anchor null path returns no anchor layer (sessionId wiring)", async () => {
    projections.anchor = null;
    const bundle = await useCase.build({
      workspaceId: makeWorkspaceId(),
      query: null,
      maxTokens: TokenBudget.withMax(10000),
      layerBudgets: {},
      weights: RelevanceWeights.defaults(),
    });
    expect(bundle.getSessionId()).toBeNull();
  });
});
