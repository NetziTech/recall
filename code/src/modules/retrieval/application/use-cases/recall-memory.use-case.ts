import type { Clock } from "../../../../shared/application/ports/clock.port.ts";
import type { Logger } from "../../../../shared/application/ports/logger.port.ts";
import { NonEmptyString } from "../../../../shared/domain/value-objects/non-empty-string.ts";
import { Tokens } from "../../../../shared/domain/value-objects/tokens.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import { LearningSeverity } from "../../../memory/domain/value-objects/learning-severity.ts";
import { RankedEntry } from "../../domain/aggregates/ranked-entry.ts";
import {
  RecallResult,
  type RecallFallbackReasonValue,
} from "../../domain/aggregates/recall-result.ts";
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
import type { CosineScore } from "../../domain/value-objects/cosine-score.ts";
import { PriorityBoost } from "../../domain/value-objects/priority-boost.ts";
import { QueryKind, type QueryKindValue } from "../../domain/value-objects/query-kind.ts";
import type { Query } from "../../domain/value-objects/query.ts";
import type { RecallFilters } from "../../domain/value-objects/recall-filters.ts";
import { RecencyScore } from "../../domain/value-objects/recency-score.ts";
import type { RelevanceWeights } from "../../domain/value-objects/relevance-weights.ts";
import type { TokenBudget } from "../../domain/value-objects/token-budget.ts";
import { UsageScore } from "../../domain/value-objects/usage-score.ts";
import type { RecallMemory } from "../ports/in/recall-memory.port.ts";
import type {
  MemoryProjection,
  MemoryProjectionRepository,
} from "../ports/out/memory-projection-repository.port.ts";

/**
 * Default half-life of the recency component, in milliseconds (30
 * days). The choice mirrors `docs/04-capas-contexto.md` §3.4 — a turn
 * decays so its score is ~0.5 around 30 days. The half-life is a
 * recall-time tuning knob; the curator's separate per-day decay still
 * applies to the persisted `confidence`.
 */
const DEFAULT_RECENCY_HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Inner-pipeline candidate: a memory projection enriched with the
 * lexical and semantic raw scores observed during the search step.
 *
 * Kept private to this use case so the refactor surface stays small.
 */
interface ScoredCandidate {
  readonly projection: MemoryProjection;
  readonly bm25: BM25Score | null;
  readonly cosine: CosineScore | null;
}

/**
 * Use case: hybrid recall over the memory bounded context.
 *
 * Architecture: see `RecallMemory` driving-port docstring for the
 * pipeline diagram. This implementation is the canonical entry point;
 * tests exercise it with in-memory fakes for every output port.
 *
 * Concurrency:
 * - The lexical search and the embedder + vector search run in
 *   parallel via `Promise.all`. The two sub-pipelines are independent
 *   (the embedder feeds only the vector search) so combining them with
 *   a `Promise.all` halves the wall-clock at the cost of one extra
 *   embedder request that may be wasted when the embedder fails (the
 *   trade-off is acceptable: embedder failures are rare and the
 *   fallback is correct).
 *
 * Async embeddings (`docs/01-arquitectura.md` §2.7):
 * - The use case does NOT block waiting for any pending embeddings to
 *   be computed. Entries with `embedding_status !== 'ready'` simply do
 *   not surface from the vector search — the projections that come
 *   back through the FTS5 path with no cosine component still get a
 *   final score (just lower than they would have with both signals).
 * - When the embedder itself is unavailable for the QUERY embedding,
 *   the use case skips the vector search entirely and reports
 *   `fallback_reason: "embedder_unavailable"`. When the vector search
 *   succeeds but the result set is empty (every candidate was retrieved
 *   only by FTS5), the use case reports `fallback_reason:
 *   "no_embeddings_yet"` to communicate that the bottleneck is the
 *   embedding-queue depth, not the embedder service.
 *
 * Side effects:
 * - On a successful recall, the use case calls
 *   `MemoryProjectionRepository.bumpUsage` to bump `use_count` and
 *   `last_used_ms`. Failures of that call are LOGGED at warn level but
 *   do NOT propagate — the recall still returns its results.
 */
export class RecallMemoryUseCase implements RecallMemory {
  public constructor(
    private readonly embedder: Embedder,
    private readonly lexical: LexicalSearch,
    private readonly vector: VectorSearch,
    private readonly projections: MemoryProjectionRepository,
    private readonly tokenCounter: TokenCounter,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  public async recall(input: {
    workspaceId: WorkspaceId;
    query: Query | null;
    filters: RecallFilters;
    maxTokens: TokenBudget;
    weights: RelevanceWeights;
  }): Promise<RecallResult> {
    const now = this.clock.now();

    if (input.query === null) {
      return this.recallFilterOnly({
        filters: input.filters,
        now,
      });
    }

    const query = input.query;
    const lexicalPromise = this.lexical
      .search(query.text, input.workspaceId, input.filters)
      .catch((cause: unknown) => {
        this.logger.warn(
          {
            workspaceId: input.workspaceId.toString(),
            err: cause instanceof Error ? cause.message : String(cause),
          },
          "lexical search failed; continuing without BM25",
        );
        const empty: readonly LexicalSearchHit[] = [];
        return empty;
      });

    const embedderPromise = this.runEmbeddedSearch({
      query,
      workspaceId: input.workspaceId,
      filters: input.filters,
    });

    const [bm25Hits, vectorOutcome] = await Promise.all([
      lexicalPromise,
      embedderPromise,
    ]);

    const cosineHits: readonly VectorSearchHit[] = vectorOutcome.ok
      ? vectorOutcome.hits
      : [];

    const candidates = await this.hydrateCandidates({
      workspaceId: input.workspaceId,
      bm25Hits,
      cosineHits,
    });

    const fallback = this.classifyFallback({
      embedderOk: vectorOutcome.ok,
      cosineCount: cosineHits.length,
      candidatesCount: candidates.length,
    });

    const ranked = this.rankAndSlice({
      candidates,
      filters: input.filters,
      weights: input.weights,
      now,
      maxTokens: input.maxTokens,
    });

    if (ranked.entries.length > 0) {
      await this.bumpUsageSafely(input.workspaceId, ranked.entries, now);
    }

    return RecallResult.of({
      query,
      filters: input.filters,
      entries: ranked.entries,
      totalCandidates: candidates.length,
      totalTokens: ranked.totalTokens,
      fallbackReason: fallback,
      executedAt: now,
    });
  }

  // -- pipeline steps ----------------------------------------------------

  private recallFilterOnly(input: {
    filters: RecallFilters;
    now: Timestamp;
  }): Promise<RecallResult> {
    // No query → no lexical or vector signal. Returning an empty
    // result here keeps the protocol contract (`mem.recall.query` is
    // optional per `docs/02-protocolo-mcp.md` §4.3 but the pipeline
    // is undefined for that case). The application boundary that
    // actually wants a "list recent N regardless of query" path uses
    // the structural reads of `MemoryProjectionRepository` directly.
    return Promise.resolve(
      RecallResult.of({
        query: null,
        filters: input.filters,
        entries: [],
        totalCandidates: 0,
        totalTokens: Tokens.zero(),
        fallbackReason: null,
        executedAt: input.now,
      }),
    );
  }

  private async runEmbeddedSearch(input: {
    query: Query;
    workspaceId: WorkspaceId;
    filters: RecallFilters;
  }): Promise<
    | { readonly ok: true; readonly hits: readonly VectorSearchHit[] }
    | { readonly ok: false }
  > {
    try {
      const qVec = await this.embedder.embed(input.query.text.toString());
      const hits = await this.vector.search(
        qVec,
        input.workspaceId,
        input.filters,
      );
      return { ok: true, hits };
    } catch (cause: unknown) {
      this.logger.warn(
        {
          workspaceId: input.workspaceId.toString(),
          err: cause instanceof Error ? cause.message : String(cause),
        },
        "embedder or vector search failed; falling back to FTS5-only",
      );
      return { ok: false };
    }
  }

  private async hydrateCandidates(input: {
    workspaceId: WorkspaceId;
    bm25Hits: readonly LexicalSearchHit[];
    cosineHits: readonly VectorSearchHit[];
  }): Promise<readonly ScoredCandidate[]> {
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

    const out: ScoredCandidate[] = [];
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

  private rankAndSlice(input: {
    candidates: readonly ScoredCandidate[];
    filters: RecallFilters;
    weights: RelevanceWeights;
    now: Timestamp;
    maxTokens: TokenBudget;
  }): { readonly entries: readonly RankedEntry[]; readonly totalTokens: Tokens } {
    if (input.candidates.length === 0) {
      return { entries: [], totalTokens: Tokens.zero() };
    }

    let maxBm25 = 0;
    let maxUseCount = 0;
    for (const cand of input.candidates) {
      const b = cand.bm25 === null ? 0 : cand.bm25.toNumber();
      if (b > maxBm25) maxBm25 = b;
      const u = cand.projection.useCount.toNumber();
      if (u > maxUseCount) maxUseCount = u;
    }

    const ranked: { readonly entry: RankedEntry; readonly score: number }[] = [];

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

      const relevance = HybridScorer.score({
        bm25: bm25Norm,
        cosine: cand.cosine,
        recency,
        usage,
        priorityBoost,
        weights: input.weights,
      });

      const queryKind = this.queryKindOf(proj.kind);
      const lastUsedAtTs =
        proj.lastUsedAt.kind === "at" ? proj.lastUsedAt.at : null;
      const entry = RankedEntry.of({
        kind: queryKind,
        id: proj.id,
        title: NonEmptyString.create(proj.title, "title"),
        preview: NonEmptyString.create(proj.preview, "preview"),
        tags: proj.tags,
        relevanceScore: relevance,
        bm25Score: bm25Norm,
        cosineScore: cand.cosine,
        createdAt: proj.createdAt,
        lastUsedAt: lastUsedAtTs,
      });
      ranked.push({ entry, score: relevance.toNumber() });
    }

    ranked.sort((a, b) => b.score - a.score);

    const limited = ranked.slice(0, input.filters.limit);

    const out: RankedEntry[] = [];
    let runningTokens = 0;
    const max = input.maxTokens.maxTokens;
    for (const candidate of limited) {
      const tokens = this.tokenCounter
        .count(this.renderTokenInput(candidate.entry))
        .toNumber();
      if (runningTokens + tokens > max) break;
      runningTokens += tokens;
      out.push(candidate.entry);
    }

    return {
      entries: Object.freeze(out),
      totalTokens: Tokens.of(runningTokens),
    };
  }

  private classifyFallback(input: {
    embedderOk: boolean;
    cosineCount: number;
    candidatesCount: number;
  }): RecallFallbackReasonValue | null {
    if (!input.embedderOk) return "embedder_unavailable";
    if (input.candidatesCount > 0 && input.cosineCount === 0) {
      return "no_embeddings_yet";
    }
    return null;
  }

  private async bumpUsageSafely(
    workspaceId: WorkspaceId,
    entries: readonly RankedEntry[],
    at: Timestamp,
  ): Promise<void> {
    try {
      await this.projections.bumpUsage({
        workspaceId,
        touched: entries.map((e) => ({ kind: e.kind.value, id: e.id })),
        at,
      });
    } catch (cause: unknown) {
      this.logger.warn(
        {
          workspaceId: workspaceId.toString(),
          err: cause instanceof Error ? cause.message : String(cause),
        },
        "bumpUsage failed; recall results returned unaffected",
      );
    }
  }

  // -- helpers -----------------------------------------------------------

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
      // Critical learnings dominate the ranking but stay below the
      // hard cap of `MAX_PRIORITY_BOOST` (10) so tags-based clustering
      // can still tie-break.
      return PriorityBoost.of(3);
    }
    if (proj.severity.equals(LearningSeverity.warning())) {
      return PriorityBoost.of(1.5);
    }
    return PriorityBoost.none();
  }

  private renderTokenInput(entry: RankedEntry): string {
    return `${entry.title.toString()}\n${entry.preview.toString()}`;
  }
}
