/**
 * Bench C — `mem.context` (assemble 7-layer bundle).
 *
 * SLO: p95 < 200ms (per `docs/01-arquitectura.md` §10 / Tarea 5.4).
 * The use case orchestrates seven projection lookups (anchor,
 * decisions, tasks, turns, open questions) plus a query-driven
 * lexical+semantic search for `relevant_memory` and `code_map`. The
 * brief asks for a "medium" corpus (~500 mixed items); we seed
 * 200 decisions + 200 learnings + 100 turns + a workspace_config
 * row, drain the embedding queue, and time `build()` 50 times.
 *
 * Iterations: 50 measured + 3 warmup. The bundle assembly is heavier
 * than recall (it issues 5+ SELECTs in parallel via `Promise.all`),
 * so we keep the iteration count moderate.
 */
import { bench, describe } from "vitest";

import { Tags } from "../../src/shared/domain/value-objects/tags.ts";
import { Scope } from "../../src/modules/memory/domain/value-objects/scope.ts";
import { LearningSeverity } from "../../src/modules/memory/domain/value-objects/learning-severity.ts";
import { TaskPriority } from "../../src/modules/memory/domain/value-objects/task-priority.ts";
import { Query } from "../../src/modules/retrieval/domain/value-objects/query.ts";
import { QueryText } from "../../src/modules/retrieval/domain/value-objects/query-text.ts";
import { RelevanceWeights } from "../../src/modules/retrieval/domain/value-objects/relevance-weights.ts";
import { TokenBudget } from "../../src/modules/retrieval/domain/value-objects/token-budget.ts";
import { buildTestContainer } from "../integration/_helpers/build-test-container.ts";
import { registerBench } from "./_helpers/bench-reporter.ts";

const BENCH_NAME = "C. mem.context (7-layer bundle, ~500 corpus)";
const TARGET_P95_MS = 200;
const ITERATIONS = 50;
const WARMUP_ITERATIONS = 3;

const CORPUS_DECISIONS = 200;
const CORPUS_LEARNINGS = 200;
const CORPUS_TURNS = 100;

const ctx = await buildTestContainer();
process.on("beforeExit", () => {
  void ctx.cleanup();
});

// The retrieval projection adapter for `loadWorkspaceAnchor` reads
// `workspace_config`; the test container does not invoke
// `InitializeWorkspaceUseCase`, so we mirror what the workspace's
// projection writer would emit.
ctx.database
  .prepare(
    `INSERT INTO workspace_config (
       workspace_id, display_name, mode, created_at_ms,
       updated_at_ms, metadata_json
     ) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(workspace_id) DO UPDATE SET
       updated_at_ms = excluded.updated_at_ms`,
  )
  .run(ctx.workspaceId.toString(), "bench-workspace", "shared", 0, 0, "{}");

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

// Seed corpus.
for (let i = 0; i < CORPUS_DECISIONS; i += 1) {
  await ctx.memory.recordDecision.record({
    workspaceId: ctx.workspaceId,
    sessionId: null,
    title: `Decision ${String(i)} — adopt ${topicAt(i)}`,
    rationale: `Rationale ${String(i)} for ${topicAt(i)}.`,
    tags: Tags.create(["bench", "context"]),
    scope: Scope.project(),
  });
}
for (let i = 0; i < CORPUS_LEARNINGS; i += 1) {
  await ctx.memory.recordLearning.record({
    workspaceId: ctx.workspaceId,
    text: `Learning ${String(i)}: ${topicAt(i)} should be tested deliberately.`,
    severity: LearningSeverity.tip(),
    tags: Tags.create(["bench", "context"]),
    scope: Scope.project(),
  });
}
for (let i = 0; i < CORPUS_TURNS; i += 1) {
  await ctx.memory.recordTurn.record({
    workspaceId: ctx.workspaceId,
    summary: `Turn ${String(i)} — discussed ${topicAt(i)} during the bench.`,
    intent: null,
    outcome: null,
    filesTouched: [],
    linkedDecisions: [],
    linkedLearnings: [],
    tags: Tags.empty(),
  });
}

// Track an open task so the `active_tasks` layer is non-empty.
await ctx.memory.trackTask.create({
  workspaceId: ctx.workspaceId,
  title: "Bench task — wire mem.context p95 monitor",
  description: "Bundle assembly latency dashboard.",
  priority: TaskPriority.high(),
  tags: Tags.empty(),
  dueAtMs: null,
});

// Drain the embedding queue so the query-driven layers exercise the
// vector path, not the no_embeddings_yet fallback.
for (let pass = 0; pass < 60; pass += 1) {
  const result = await ctx.retrieval.embedAndPersist.drainBatch({
    workspaceId: ctx.workspaceId,
    batchSize: 100,
    backoffWindowMs: 0,
  });
  if (result.processed.length === 0) break;
}

const recorder = registerBench({ name: BENCH_NAME, targetMs: TARGET_P95_MS });

describe("bench / C / mem.context", () => {
  bench(
    BENCH_NAME,
    async () => {
      const t0 = performance.now();
      await ctx.retrieval.getContextBundle.build({
        workspaceId: ctx.workspaceId,
        query: Query.create({
          text: QueryText.create("hexagonal architecture domain"),
          kinds: [],
          tags: Tags.empty(),
          mustHaveTags: Tags.empty(),
          mustNotHaveTags: Tags.empty(),
          includeSuperseded: false,
        }),
        maxTokens: TokenBudget.withMax(2000),
        layerBudgets: Object.freeze({}),
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
