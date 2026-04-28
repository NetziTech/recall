/**
 * Bench A — `mem.remember` (decision persist + queue).
 *
 * SLO: p95 < 30ms (per `docs/06-stack-tecnico.md` §SLO and Tarea 5.4).
 * The use case is the synchronous slice users perceive when calling
 * `mem.remember`: it persists the decision row through the
 * aggregate's repository and enqueues an `embedding_queue` row. The
 * embedder is NOT touched on the write path (the queue worker
 * batches the model call asynchronously).
 *
 * Setup:
 *   - Real `SqliteDatabase` over a tmpfile (NOT `:memory:` — the
 *     `vec0(...)` virtual table from migration 002 needs the
 *     extension loaded against a real handle).
 *   - Real composition wiring (`buildTestContainer`) with the
 *     deterministic `StubRawEmbedder`. Every other adapter is the
 *     production wiring.
 *   - `FakeClock` so the timestamps stamped onto rows are
 *     reproducible run-to-run.
 *
 * Iterations: 200 measured + 5 warmup. The container is built at
 * module load (top-level await) and torn down on
 * `process.beforeExit`, because vitest's bench runner does NOT
 * execute `beforeAll`/`afterAll` hooks (see
 * `node_modules/vitest/dist/runners.js#runBenchmarkSuite`).
 */
import { bench, describe } from "vitest";

import { Tags } from "../../src/shared/domain/value-objects/tags.ts";
import { Scope } from "../../src/modules/memory/domain/value-objects/scope.ts";
import { buildTestContainer } from "../integration/_helpers/build-test-container.ts";
import { registerBench } from "./_helpers/bench-reporter.ts";

const BENCH_NAME = "A. mem.remember (decision)";
const TARGET_P95_MS = 30;
const ITERATIONS = 200;
const WARMUP_ITERATIONS = 5;

const ctx = await buildTestContainer();
process.on("beforeExit", () => {
  void ctx.cleanup();
});

const recorder = registerBench({ name: BENCH_NAME, targetMs: TARGET_P95_MS });
let counter = 0;

describe("bench / A / mem.remember", () => {
  bench(
    BENCH_NAME,
    async () => {
      const i = counter;
      counter += 1;
      const t0 = performance.now();
      await ctx.memory.recordDecision.record({
        workspaceId: ctx.workspaceId,
        sessionId: null,
        title: `bench remember decision ${String(i)}`,
        rationale:
          `Iteration ${String(i)} — synthetic rationale describing a ` +
          "decision the bench harness records to measure write latency.",
        tags: Tags.create(["bench", "remember"]),
        scope: Scope.project(),
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
