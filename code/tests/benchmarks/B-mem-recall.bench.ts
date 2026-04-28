/**
 * Bench B — `mem.recall` (hybrid lexical + semantic search).
 *
 * SLO: p95 < 100ms over 50K entries (per `docs/01-arquitectura.md`
 * §10 / `docs/06-stack-tecnico.md`). The Tarea 5.4 brief tightens the
 * realistic corpus to 100 mixed memory rows because:
 *   1. The 50K target is a steady-state guarantee for the documented
 *      production deployment; the 100-row corpus exercises the same
 *      hot path (`SqliteLexicalSearch`, `SqliteVectorSearch`,
 *      `HybridScorer`) without inflating the bench's wall-clock to
 *      multiple minutes per iteration.
 *   2. The 50K corpus is exercised in bench F (curator pass) which
 *      times the heavy batch end-to-end.
 *
 * The corpus is seeded with 100 rows (50 decisions + 50 learnings)
 * AND each row's embedding is materialised through
 * `EmbedAndPersistUseCase.drainBatch` so the `vec0` adapter has
 * actual vectors to score. Without that step every recall returns
 * `no_embeddings_yet` and the cosine path is dead-coded.
 *
 * Iterations: 100 measured + 5 warmup, same query repeated. The
 * recall use case bumps `use_count` per surfaced entry; the SQL
 * UPDATE cost is part of the SLO so we leave it in the hot loop.
 */
import { bench, describe } from "vitest";

import { Tags } from "../../src/shared/domain/value-objects/tags.ts";
import { Scope } from "../../src/modules/memory/domain/value-objects/scope.ts";
import { LearningSeverity } from "../../src/modules/memory/domain/value-objects/learning-severity.ts";
import { Query } from "../../src/modules/retrieval/domain/value-objects/query.ts";
import { QueryText } from "../../src/modules/retrieval/domain/value-objects/query-text.ts";
import { RecallFilters } from "../../src/modules/retrieval/domain/value-objects/recall-filters.ts";
import { RelevanceWeights } from "../../src/modules/retrieval/domain/value-objects/relevance-weights.ts";
import { TokenBudget } from "../../src/modules/retrieval/domain/value-objects/token-budget.ts";
import { buildTestContainer } from "../integration/_helpers/build-test-container.ts";
import { registerBench } from "./_helpers/bench-reporter.ts";

const BENCH_NAME = "B. mem.recall (hybrid, ~100-row corpus)";
const TARGET_P95_MS = 100;
const ITERATIONS = 100;
const WARMUP_ITERATIONS = 5;

const CORPUS_DECISIONS = 50;
const CORPUS_LEARNINGS = 50;

// ── corpus ────────────────────────────────────────────────────────────────
const TOPICS: readonly string[] = Object.freeze([
  "hexagonal architecture",
  "SQLite persistence",
  "BM25 lexical scoring",
  "cosine semantic ranking",
  "domain-driven design",
  "value objects immutability",
  "ports and adapters",
  "embedding queue worker",
  "context bundle layers",
  "curator decay pass",
]);

function topicAt(i: number): string {
  return TOPICS[i % TOPICS.length] ?? "fallback";
}

const ctx = await buildTestContainer();
process.on("beforeExit", () => {
  void ctx.cleanup();
});

// Seed the corpus.
for (let i = 0; i < CORPUS_DECISIONS; i += 1) {
  await ctx.memory.recordDecision.record({
    workspaceId: ctx.workspaceId,
    sessionId: null,
    title: `Decision ${String(i)} — adopt ${topicAt(i)}`,
    rationale:
      `Synthetic rationale ${String(i)}: choosing ${topicAt(i)} keeps the ` +
      "domain neutral and the adapters swappable.",
    tags: Tags.create(["bench", "recall"]),
    scope: Scope.project(),
  });
}
for (let i = 0; i < CORPUS_LEARNINGS; i += 1) {
  await ctx.memory.recordLearning.record({
    workspaceId: ctx.workspaceId,
    text: `Learning ${String(i)}: ${topicAt(i)} requires deliberate testing.`,
    severity: i % 3 === 0 ? LearningSeverity.warning() : LearningSeverity.tip(),
    tags: Tags.create(["bench", "recall"]),
    scope: Scope.project(),
  });
}

// Drain the embedding queue so vec0 has vectors to score against.
// `drainBatch` processes up to `batchSize` rows; we loop until the
// queue is empty so every seeded row is embedded.
let drained = 0;
for (let pass = 0; pass < 20; pass += 1) {
  const result = await ctx.retrieval.embedAndPersist.drainBatch({
    workspaceId: ctx.workspaceId,
    batchSize: 50,
    backoffWindowMs: 0,
  });
  drained += result.processed.length;
  if (result.processed.length === 0) break;
}
if (drained === 0) {
  throw new Error("bench B: failed to drain embedding queue (empty result)");
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

const recorder = registerBench({ name: BENCH_NAME, targetMs: TARGET_P95_MS });

describe("bench / B / mem.recall", () => {
  bench(
    BENCH_NAME,
    async () => {
      const t0 = performance.now();
      await ctx.retrieval.recallMemory.recall({
        workspaceId: ctx.workspaceId,
        query: buildQuery("hexagonal architecture domain"),
        filters: defaultFilters(),
        maxTokens: TokenBudget.withMax(2000),
        weights: RelevanceWeights.defaults(),
      });
      const t1 = performance.now();
      recorder.record(t1 - t0);
      if (recorder.samples().length >= ITERATIONS) recorder.markComplete();
    },
    {
      iterations: ITERATIONS,
      time: 0,
      warmupIterations: WARMUP_ITERATIONS,
      warmupTime: 0,
    },
  );
});
