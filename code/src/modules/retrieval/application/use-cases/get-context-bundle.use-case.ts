import type { Clock } from "../../../../shared/application/ports/clock.port.ts";
import type { IdGenerator } from "../../../../shared/application/ports/id-generator.port.ts";
import type { Logger } from "../../../../shared/application/ports/logger.port.ts";
import { NonEmptyString } from "../../../../shared/domain/value-objects/non-empty-string.ts";
import { Tags } from "../../../../shared/domain/value-objects/tags.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import { Tokens } from "../../../../shared/domain/value-objects/tokens.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import { LearningSeverity } from "../../../memory/domain/value-objects/learning-severity.ts";
import { BundleId } from "../../domain/aggregates/bundle-id.ts";
import { ContextBundle } from "../../domain/aggregates/context-bundle.ts";
import type { Embedder } from "../../domain/services/embedder.ts";
import { HybridScorer } from "../../domain/services/hybrid-scorer.ts";
import type {
  LexicalSearch,
  LexicalSearchHit,
} from "../../domain/services/lexical-search.ts";
import type { TokenCounter } from "../../domain/services/token-counter.ts";
import type {
  VectorSearch,
  VectorSearchHit,
} from "../../domain/services/vector-search.ts";
import { BM25Score } from "../../domain/value-objects/bm25-score.ts";
import { ContextLayer } from "../../domain/value-objects/context-layer.ts";
import { type ContextLayerKindValue } from "../../domain/value-objects/context-layer-kind.ts";
import type { CosineScore } from "../../domain/value-objects/cosine-score.ts";
import type { DecisionRef } from "../../domain/value-objects/decision-ref.ts";
import type { EntityRef } from "../../domain/value-objects/entity-ref.ts";
import { MemoryRef } from "../../domain/value-objects/memory-ref.ts";
import type { OpenQuestionRef } from "../../domain/value-objects/open-question-ref.ts";
import { PriorityBoost } from "../../domain/value-objects/priority-boost.ts";
import {
  QueryKind,
  type QueryKindValue,
} from "../../domain/value-objects/query-kind.ts";
import type { Query } from "../../domain/value-objects/query.ts";
import { RecallFilters } from "../../domain/value-objects/recall-filters.ts";
import { RecencyScore } from "../../domain/value-objects/recency-score.ts";
import type { RelevanceScore } from "../../domain/value-objects/relevance-score.ts";
import type { RelevanceWeights } from "../../domain/value-objects/relevance-weights.ts";
import type { TaskRef } from "../../domain/value-objects/task-ref.ts";
import type { TokenBudget } from "../../domain/value-objects/token-budget.ts";
import type { TurnRef } from "../../domain/value-objects/turn-ref.ts";
import { UsageScore } from "../../domain/value-objects/usage-score.ts";
import type { WorkspaceAnchorPayload } from "../../domain/value-objects/workspace-anchor-payload.ts";
import type {
  GetContextBundle,
  LayerBudgetOverrides,
} from "../ports/in/get-context-bundle.port.ts";
import type {
  MemoryProjection,
  MemoryProjectionRepository,
} from "../ports/out/memory-projection-repository.port.ts";

const DEFAULT_RECENCY_HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Per-layer default budgets. Mirror the table in
 * `docs/04-capas-contexto.md` §2.
 */
const DEFAULT_LAYER_BUDGETS: Readonly<Record<ContextLayerKindValue, number>> =
  Object.freeze({
    workspace_anchor: 200,
    active_decisions: 600,
    open_tasks: 400,
    recent_turns: 800,
    relevant_memory: 1500,
    entities_in_focus: 600,
    open_questions: 300,
  });

/**
 * Recent-turns sample size (Capa 4 default per
 * `docs/04-capas-contexto.md` §3.4 — "ordenado por
 * `recorded_at_ms DESC`, top 5-8"). The use case caps to 5 by
 * default; the application boundary may pass a larger value through
 * the `limit` of `MemoryProjectionRepository.listRecentTurns`.
 */
const DEFAULT_RECENT_TURNS_LIMIT = 8;

/**
 * Open-questions session window (Capa 7 default per
 * `docs/04-capas-contexto.md` §3.7 — "ultimas 5 sesiones cerradas").
 */
const DEFAULT_OPEN_QUESTIONS_SESSION_WINDOW = 5;

/**
 * Soft cap on the number of items each non-search layer pulls before
 * the token budget kicks in. Larger than the rendered count so the
 * budget pass has room to drop entries that do not fit.
 */
const DEFAULT_LAYER_FETCH_LIMIT = 32;

/**
 * Use case: build the seven-layer `ContextBundle`.
 *
 * Architecture: see `GetContextBundle` driving-port docstring for the
 * pipeline diagram.
 *
 * Layer fan-out:
 * - Layers 1, 2, 3, 4, 7 are pure structured reads → run in parallel
 *   via `Promise.all`. They do NOT touch the embedder or FTS5.
 * - Layers 5 and 6 share the embedder result (one embedder call,
 *   two consumers) and run their searches in parallel.
 *
 * Cross-layer dedup:
 * - The bundle aggregator does NOT enforce dedup itself; that is the
 *   use case's job. We dedupe AFTER scoring and BEFORE the budget
 *   pass: an entry that already appears in a higher-priority layer
 *   (lower `priority()` number) is dropped from the lower-priority
 *   one. The dedup key is `(kind, id)`.
 *
 * Token budget:
 * - Each layer's tokens are counted by the `TokenCounter` adapter on
 *   a per-entry basis: we sum the rendered cost of every payload and
 *   if a layer would exceed its per-layer cap, we trim the tail
 *   (lowest-score entries first for `relevant_memory`, lowest-priority
 *   entries first for `open_tasks`, etc.).
 * - The bundle aggregator enforces the GLOBAL `maxTokens` ceiling via
 *   `addLayer(...)` (which throws `TokenBudgetExceededError`). The
 *   use case catches that and calls `bundle.truncate(...)` to drop
 *   the lowest-priority layers.
 */
export class GetContextBundleUseCase implements GetContextBundle {
  public constructor(
    private readonly embedder: Embedder,
    private readonly lexical: LexicalSearch,
    private readonly vector: VectorSearch,
    private readonly projections: MemoryProjectionRepository,
    private readonly tokenCounter: TokenCounter,
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
    private readonly logger: Logger,
  ) {}

  public async build(input: {
    workspaceId: WorkspaceId;
    query: Query | null;
    maxTokens: TokenBudget;
    layerBudgets: LayerBudgetOverrides;
    weights: RelevanceWeights;
  }): Promise<ContextBundle> {
    const now = this.clock.now();
    const bundleId = BundleId.from(this.idGenerator.generateString());

    const anchorPromise = this.projections.loadWorkspaceAnchor(
      input.workspaceId,
    );
    const decisionsPromise = this.projections.listActiveDecisions({
      workspaceId: input.workspaceId,
      limit: DEFAULT_LAYER_FETCH_LIMIT,
    });
    const tasksPromise = this.projections.listOpenTasks({
      workspaceId: input.workspaceId,
      limit: DEFAULT_LAYER_FETCH_LIMIT,
    });
    const turnsPromise = this.projections.listRecentTurns({
      workspaceId: input.workspaceId,
      limit: DEFAULT_RECENT_TURNS_LIMIT,
    });
    const openQuestionsPromise = this.projections.listOpenQuestions({
      workspaceId: input.workspaceId,
      sessionLimit: DEFAULT_OPEN_QUESTIONS_SESSION_WINDOW,
      limit: DEFAULT_LAYER_FETCH_LIMIT,
    });

    const queryDrivenPromise = this.runQueryDrivenLayers({
      workspaceId: input.workspaceId,
      query: input.query,
      weights: input.weights,
      now,
    });

    const [
      anchor,
      decisions,
      tasks,
      turns,
      openQuestions,
      queryDriven,
    ] = await Promise.all([
      anchorPromise,
      decisionsPromise,
      tasksPromise,
      turnsPromise,
      openQuestionsPromise,
      queryDrivenPromise,
    ]);

    const session = anchor === null ? null : anchor.activeSessionId;

    const bundle = ContextBundle.assemble({
      id: bundleId,
      workspaceId: input.workspaceId,
      sessionId: session,
      query: input.query,
      tokenBudget: input.maxTokens,
      occurredAt: now,
    });

    const seenIds = new Set<string>();
    // The wire contract (docs/02 §4.2) demands all seven canonical
    // layers be present in every `mem.context` response. We therefore
    // emit each layer unconditionally; layers without content surface
    // as empty payloads (`entries_count: 0`, `tokens: 0`) and are
    // skipped by the budget pass because their token cost is zero.
    this.tryAddLayer(bundle, this.buildAnchorLayer(anchor, input.layerBudgets), now);

    if (anchor !== null) {
      this.markSeen(seenIds, "workspace_anchor", anchor.workspaceId.toString());
    }

    this.tryAddLayer(
      bundle,
      this.buildDecisionsLayer({
        refs: decisions,
        seenIds,
        override: input.layerBudgets,
      }),
      now,
    );

    this.tryAddLayer(
      bundle,
      this.buildTasksLayer({
        refs: tasks,
        seenIds,
        override: input.layerBudgets,
      }),
      now,
    );

    this.tryAddLayer(
      bundle,
      this.buildTurnsLayer({
        refs: turns,
        seenIds,
        override: input.layerBudgets,
      }),
      now,
    );

    this.tryAddLayer(
      bundle,
      this.buildRelevantMemoryLayer({
        hits: queryDriven.recallEntries,
        seenIds,
        override: input.layerBudgets,
      }),
      now,
    );

    this.tryAddLayer(
      bundle,
      this.buildEntitiesLayer({
        refs: queryDriven.entityRefs,
        seenIds,
        override: input.layerBudgets,
      }),
      now,
    );

    this.tryAddLayer(
      bundle,
      this.buildOpenQuestionsLayer({
        refs: openQuestions,
        override: input.layerBudgets,
      }),
      now,
    );

    bundle.truncate({
      newMaxTokens: input.maxTokens.maxTokens,
      occurredAt: now,
    });

    return bundle;
  }

  // -- structural layer builders ----------------------------------------

  private buildAnchorLayer(
    anchor: WorkspaceAnchorPayload | null,
    overrides: LayerBudgetOverrides,
  ): ContextLayer {
    if (anchor === null) {
      // Fresh / pre-006 workspace: emit an empty anchor layer so the
      // wire contract (docs/02 §4.2) of "always seven layers" holds.
      return ContextLayer.workspaceAnchor({
        payload: null,
        tokens: Tokens.zero(),
      });
    }
    const renderedTokens = this.tokenCounter.count(this.renderAnchor(anchor));
    const cap = this.layerCap("workspace_anchor", overrides);
    const tokens = this.clampTokens(renderedTokens, cap);
    return ContextLayer.workspaceAnchor({ payload: anchor, tokens });
  }

  private buildDecisionsLayer(input: {
    refs: readonly DecisionRef[];
    seenIds: Set<string>;
    override: LayerBudgetOverrides;
  }): ContextLayer {
    const cap = this.layerCap("active_decisions", input.override);
    const filtered: DecisionRef[] = [];
    let runningTokens = 0;
    for (const ref of input.refs) {
      const key = this.dedupKey("decision", ref.id.toString());
      if (input.seenIds.has(key)) continue;
      const cost = this.tokenCounter
        .count(this.renderDecisionRef(ref))
        .toNumber();
      if (runningTokens + cost > cap) break;
      runningTokens += cost;
      filtered.push(ref);
      input.seenIds.add(key);
    }
    return ContextLayer.activeDecisions({
      payload: filtered,
      tokens: Tokens.of(runningTokens),
    });
  }

  private buildTasksLayer(input: {
    refs: readonly TaskRef[];
    seenIds: Set<string>;
    override: LayerBudgetOverrides;
  }): ContextLayer {
    const cap = this.layerCap("open_tasks", input.override);
    const filtered: TaskRef[] = [];
    let runningTokens = 0;
    for (const ref of input.refs) {
      const key = this.dedupKey("task", ref.id.toString());
      if (input.seenIds.has(key)) continue;
      const cost = this.tokenCounter.count(this.renderTaskRef(ref)).toNumber();
      if (runningTokens + cost > cap) break;
      runningTokens += cost;
      filtered.push(ref);
      input.seenIds.add(key);
    }
    return ContextLayer.openTasks({
      payload: filtered,
      tokens: Tokens.of(runningTokens),
    });
  }

  private buildTurnsLayer(input: {
    refs: readonly TurnRef[];
    seenIds: Set<string>;
    override: LayerBudgetOverrides;
  }): ContextLayer {
    const cap = this.layerCap("recent_turns", input.override);
    const filtered: TurnRef[] = [];
    let runningTokens = 0;
    for (const ref of input.refs) {
      const key = this.dedupKey("turn", ref.id.toString());
      if (input.seenIds.has(key)) continue;
      const cost = this.tokenCounter.count(this.renderTurnRef(ref)).toNumber();
      if (runningTokens + cost > cap) break;
      runningTokens += cost;
      filtered.push(ref);
      input.seenIds.add(key);
    }
    return ContextLayer.recentTurns({
      payload: filtered,
      tokens: Tokens.of(runningTokens),
    });
  }

  private buildRelevantMemoryLayer(input: {
    hits: readonly MemoryRef[];
    seenIds: Set<string>;
    override: LayerBudgetOverrides;
  }): ContextLayer {
    const cap = this.layerCap("relevant_memory", input.override);
    const filtered: MemoryRef[] = [];
    let runningTokens = 0;
    for (const ref of input.hits) {
      const key = this.dedupKey(ref.kind.value, ref.id);
      if (input.seenIds.has(key)) continue;
      const cost = this.tokenCounter
        .count(this.renderMemoryRef(ref))
        .toNumber();
      if (runningTokens + cost > cap) break;
      runningTokens += cost;
      filtered.push(ref);
      input.seenIds.add(key);
    }
    return ContextLayer.relevantMemory({
      payload: filtered,
      tokens: Tokens.of(runningTokens),
    });
  }

  private buildEntitiesLayer(input: {
    refs: readonly EntityRef[];
    seenIds: Set<string>;
    override: LayerBudgetOverrides;
  }): ContextLayer {
    const cap = this.layerCap("entities_in_focus", input.override);
    const filtered: EntityRef[] = [];
    let runningTokens = 0;
    for (const ref of input.refs) {
      const key = this.dedupKey("entity", ref.id.toString());
      if (input.seenIds.has(key)) continue;
      const cost = this.tokenCounter
        .count(this.renderEntityRef(ref))
        .toNumber();
      if (runningTokens + cost > cap) break;
      runningTokens += cost;
      filtered.push(ref);
      input.seenIds.add(key);
    }
    return ContextLayer.entitiesInFocus({
      payload: filtered,
      tokens: Tokens.of(runningTokens),
    });
  }

  private buildOpenQuestionsLayer(input: {
    refs: readonly OpenQuestionRef[];
    override: LayerBudgetOverrides;
  }): ContextLayer {
    const cap = this.layerCap("open_questions", input.override);
    const filtered: OpenQuestionRef[] = [];
    let runningTokens = 0;
    for (const ref of input.refs) {
      const cost = this.tokenCounter
        .count(ref.question.text.toString())
        .toNumber();
      if (runningTokens + cost > cap) break;
      runningTokens += cost;
      filtered.push(ref);
    }
    return ContextLayer.openQuestions({
      payload: filtered,
      tokens: Tokens.of(runningTokens),
    });
  }

  // -- query-driven layers (5 and 6) ------------------------------------

  private async runQueryDrivenLayers(input: {
    workspaceId: WorkspaceId;
    query: Query | null;
    weights: RelevanceWeights;
    now: Timestamp;
  }): Promise<{
    readonly recallEntries: readonly MemoryRef[];
    readonly entityRefs: readonly EntityRef[];
  }> {
    if (input.query === null) {
      return { recallEntries: [], entityRefs: [] };
    }
    const query = input.query;

    const lexicalPromise = this.lexical
      .search(query.text, input.workspaceId, this.openWorldFilters(query))
      .catch((cause: unknown) => {
        this.logger.warn(
          {
            workspaceId: input.workspaceId.toString(),
            err: cause instanceof Error ? cause.message : String(cause),
          },
          "lexical search for context bundle failed; continuing without BM25",
        );
        const empty: readonly LexicalSearchHit[] = [];
        return empty;
      });

    const vectorPromise = this.runEmbeddedSearch({
      query,
      workspaceId: input.workspaceId,
    });

    const [bm25Hits, vectorOutcome] = await Promise.all([
      lexicalPromise,
      vectorPromise,
    ]);
    const cosineHits: readonly VectorSearchHit[] = vectorOutcome.ok
      ? vectorOutcome.hits
      : [];

    const candidates = await this.hydrateCandidates({
      workspaceId: input.workspaceId,
      bm25Hits,
      cosineHits,
    });

    const memoryRefs = this.toMemoryRefs({
      candidates,
      weights: input.weights,
      now: input.now,
    });

    const entityIds = new Set<string>();
    for (const proj of candidates) {
      if (proj.projection.kind === "entity") {
        entityIds.add(proj.projection.id);
      }
    }
    let entityRefs: readonly EntityRef[] = [];
    if (entityIds.size > 0) {
      try {
        entityRefs = await this.projections.loadEntityRefsByIds({
          workspaceId: input.workspaceId,
          ids: [...entityIds],
        });
      } catch (cause: unknown) {
        this.logger.warn(
          {
            workspaceId: input.workspaceId.toString(),
            err: cause instanceof Error ? cause.message : String(cause),
          },
          "loadEntityRefsByIds failed; entities_in_focus layer will be empty",
        );
      }
    }

    return { recallEntries: memoryRefs, entityRefs };
  }

  private async runEmbeddedSearch(input: {
    query: Query;
    workspaceId: WorkspaceId;
  }): Promise<
    | { readonly ok: true; readonly hits: readonly VectorSearchHit[] }
    | { readonly ok: false }
  > {
    try {
      const qVec = await this.embedder.embed(input.query.text.toString());
      const filters = this.openWorldFilters(input.query);
      const hits = await this.vector.search(qVec, input.workspaceId, filters);
      return { ok: true, hits };
    } catch (cause: unknown) {
      this.logger.warn(
        {
          workspaceId: input.workspaceId.toString(),
          err: cause instanceof Error ? cause.message : String(cause),
        },
        "embedder/vector search for context bundle failed; relevant_memory degrades to FTS5-only",
      );
      return { ok: false };
    }
  }

  private async hydrateCandidates(input: {
    workspaceId: WorkspaceId;
    bm25Hits: readonly LexicalSearchHit[];
    cosineHits: readonly VectorSearchHit[];
  }): Promise<readonly ScoredProjection[]> {
    const bm25Index = new Map<string, BM25Score>();
    for (const hit of input.bm25Hits) {
      bm25Index.set(this.hitKey(hit.kind, hit.id), hit.score);
    }
    const cosineIndex = new Map<string, CosineScore>();
    for (const hit of input.cosineHits) {
      cosineIndex.set(this.hitKey(hit.kind, hit.id), hit.score);
    }

    const seen = new Set<string>();
    const orderedHits: { readonly kind: QueryKindValue; readonly id: string }[] =
      [];
    for (const hit of input.bm25Hits) {
      const key = this.hitKey(hit.kind, hit.id);
      if (seen.has(key)) continue;
      seen.add(key);
      orderedHits.push({ kind: hit.kind, id: hit.id });
    }
    for (const hit of input.cosineHits) {
      const key = this.hitKey(hit.kind, hit.id);
      if (seen.has(key)) continue;
      seen.add(key);
      orderedHits.push({ kind: hit.kind, id: hit.id });
    }

    if (orderedHits.length === 0) return [];

    const projections = await this.projections.loadProjectionsByHits({
      workspaceId: input.workspaceId,
      hits: orderedHits,
    });

    const out: ScoredProjection[] = [];
    for (const proj of projections) {
      const key = this.hitKey(proj.kind, proj.id);
      out.push({
        projection: proj,
        bm25: bm25Index.get(key) ?? null,
        cosine: cosineIndex.get(key) ?? null,
      });
    }
    return out;
  }

  private toMemoryRefs(input: {
    candidates: readonly ScoredProjection[];
    weights: RelevanceWeights;
    now: Timestamp;
  }): readonly MemoryRef[] {
    if (input.candidates.length === 0) return [];

    let maxBm25 = 0;
    let maxUseCount = 0;
    for (const cand of input.candidates) {
      const b = cand.bm25 === null ? 0 : cand.bm25.toNumber();
      if (b > maxBm25) maxBm25 = b;
      const u = cand.projection.useCount.toNumber();
      if (u > maxUseCount) maxUseCount = u;
    }

    const ranked: { readonly ref: MemoryRef; readonly score: number }[] = [];
    for (const cand of input.candidates) {
      const proj = cand.projection;
      const bm25Norm =
        cand.bm25 === null
          ? null
          : maxBm25 > 0
            ? cand.bm25.normalize(maxBm25)
            : BM25Score.zero();
      const recency = RecencyScore.compute(
        input.now,
        proj.lastUsedAt,
        DEFAULT_RECENCY_HALF_LIFE_MS,
      );
      const usage = UsageScore.compute(proj.useCount, maxUseCount);
      const priorityBoost = this.priorityBoostOf(proj);
      const relevance: RelevanceScore = HybridScorer.score({
        bm25: bm25Norm,
        cosine: cand.cosine,
        recency,
        usage,
        priorityBoost,
        weights: input.weights,
      });

      const lastUsedAt =
        proj.lastUsedAt.kind === "at" ? proj.lastUsedAt.at : null;
      const ref = MemoryRef.of({
        kind: this.queryKindOf(proj.kind),
        id: proj.id,
        title: NonEmptyString.create(proj.title, "title"),
        preview: NonEmptyString.create(proj.preview, "preview"),
        tags: proj.tags,
        confidence: proj.confidence,
        lastUsedAt,
        relevanceScore: relevance,
      });
      ranked.push({ ref, score: relevance.toNumber() });
    }

    ranked.sort((a, b) => b.score - a.score);
    const out: MemoryRef[] = [];
    for (const item of ranked) {
      out.push(item.ref);
    }
    return Object.freeze(out);
  }

  // -- helpers -----------------------------------------------------------

  private tryAddLayer(
    bundle: ContextBundle,
    layer: ContextLayer,
    occurredAt: Timestamp,
  ): void {
    try {
      bundle.addLayer({ layer, occurredAt });
    } catch (cause: unknown) {
      // The bundle's `addLayer` throws TokenBudgetExceededError when
      // the running total would exceed the global cap. The use case
      // catches it and lets the layer be dropped silently — the
      // truncation pass at the end will rebalance.
      this.logger.debug(
        {
          err: cause instanceof Error ? cause.message : String(cause),
          layer: layer.kind(),
        },
        "layer dropped due to global budget cap; will be reconciled by truncate",
      );
    }
  }

  private layerCap(
    kind: ContextLayerKindValue,
    overrides: LayerBudgetOverrides,
  ): number {
    const override = overrides[kind];
    if (override !== undefined && override > 0) return override;
    return DEFAULT_LAYER_BUDGETS[kind];
  }

  private clampTokens(tokens: Tokens, cap: number): Tokens {
    const n = tokens.toNumber();
    if (n <= cap) return tokens;
    return Tokens.of(cap);
  }

  private dedupKey(kind: string, id: string): string {
    return `${kind}::${id}`;
  }

  private markSeen(seen: Set<string>, kind: string, id: string): void {
    seen.add(this.dedupKey(kind, id));
  }

  private hitKey(kind: QueryKindValue, id: string): string {
    return `${kind}::${id}`;
  }

  private queryKindOf(kind: QueryKindValue): QueryKind {
    switch (kind) {
      case "decision":
        return QueryKind.decision();
      case "learning":
        return QueryKind.learning();
      case "entity":
        return QueryKind.entity();
      case "task":
        return QueryKind.task();
      case "turn":
        return QueryKind.turn();
      default: {
        const exhaustive: never = kind;
        throw new Error(
          `unreachable: unknown query kind ${String(exhaustive)}`,
        );
      }
    }
  }

  private priorityBoostOf(proj: MemoryProjection): PriorityBoost {
    if (proj.severity === null) return PriorityBoost.none();
    if (proj.severity.equals(LearningSeverity.critical())) {
      return PriorityBoost.of(3);
    }
    if (proj.severity.equals(LearningSeverity.warning())) {
      return PriorityBoost.of(1.5);
    }
    return PriorityBoost.none();
  }

  private openWorldFilters(query: Query): RecallFilters {
    // Bundle assembly uses the query as a soft signal; the limit is
    // generous so the layer-by-layer budget kicks in instead of the
    // recall slice.
    const limit = 64;
    return RecallFilters.create({
      kinds: query.getKinds(),
      tags: Tags.empty(),
      mustHaveTags: query.mustHaveTags,
      mustNotHaveTags: query.mustNotHaveTags,
      minConfidence: null,
      since: null,
      until: null,
      limit,
    });
  }

  private renderAnchor(anchor: WorkspaceAnchorPayload): string {
    const intent =
      anchor.activeSessionIntent === null
        ? ""
        : `\nintent=${anchor.activeSessionIntent.toString()}`;
    return `${anchor.displayName.toString()}\nmode=${anchor.mode}${intent}`;
  }

  private renderDecisionRef(ref: DecisionRef): string {
    return `${ref.title.toString()}\nscope=${ref.scope.kind}`;
  }

  private renderTaskRef(ref: TaskRef): string {
    return `[${ref.status.toString()}] ${ref.title.toString()} (${ref.priority.toString()})`;
  }

  private renderTurnRef(ref: TurnRef): string {
    return ref.summary.toString();
  }

  private renderMemoryRef(ref: MemoryRef): string {
    return `${ref.title.toString()}\n${ref.preview.toString()}`;
  }

  private renderEntityRef(ref: EntityRef): string {
    const desc = ref.description.toStringOrNull() ?? "";
    return `${ref.name.toString()} (${ref.entityKind.toString()})\n${desc}`;
  }
}

/**
 * Inner-pipeline candidate: a memory projection enriched with the
 * lexical and semantic raw scores observed during the search step.
 */
interface ScoredProjection {
  readonly projection: MemoryProjection;
  readonly bm25: BM25Score | null;
  readonly cosine: CosineScore | null;
}
