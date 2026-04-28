/**
 * Bench F — curator full pass over 50K decisions.
 *
 * SLO: < 30s for 50K items (per `docs/05-memoria-decay.md` §6 and the
 * Tarea 5.4 brief). The orchestrator runs:
 *   1. `RollupSession` (skipped — trigger is `manual`).
 *   2. `ApplyDecay` over every active entry (the dominant cost: it
 *      iterates `decisions`, `learnings`, `entities`, `turns`, computes
 *      a per-row decay factor, and writes back).
 *   3. `ConsolidateSimilar`.
 *   4. `SelfHeal`.
 *   5. `PruneLowConfidence`.
 *
 * Setup:
 *   - The integration container is built once; we then bypass the
 *     use-case insert path and bulk-load 50K decisions via raw SQL
 *     (the FTS5 INSERT trigger fires automatically). The bulk load
 *     is wrapped in transactions per batch (~2-3s on a modern laptop)
 *     so the seed time does NOT count against the SLO.
 *   - `confidence` is randomised in `[0.4, 1.0]` so the prune step
 *     has rows to consider; `last_used_ms` is back-dated up to
 *     `90 * MS_PER_DAY` so decay has work to do.
 *
 * Iterations: 1 (the bench is the curator pass itself; the brief
 * specifies a single-shot measurement).
 *
 * Failure-mode handling: if the curator throws (e.g. the
 * better-sqlite3 "database busy executing a query" error surfaced by
 * `ApplyDecayUseCase`'s async iterator + concurrent writer pattern —
 * see Tarea 5.4 report §5), we still record the wall-clock until-
 * error as the sample so the SLO summary emits a FAIL verdict instead
 * of a stack trace burying the result.
 */
import { bench, describe } from "vitest";

import { CuratorRunTrigger } from "../../src/modules/curator/domain/value-objects/curator-run-trigger.ts";
import { buildTestContainer } from "../integration/_helpers/build-test-container.ts";
import { registerBench } from "./_helpers/bench-reporter.ts";

const BENCH_NAME = "F. curator full pass (50K decisions)";
const TARGET_MS = 30_000;
const ITERATIONS = 1;
const WARMUP_ITERATIONS = 0;

const CORPUS_SIZE = 50_000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const ctx = await buildTestContainer();
process.on("beforeExit", () => {
  void ctx.cleanup();
});

// ── Bulk-seed 50K decisions via raw SQL (transactional). ─────────────
const seedStart = performance.now();

const insertStmt = ctx.database.prepare(
  `INSERT INTO decisions (
     id, created_at_ms, title, rationale, alternatives_rejected,
     scope, module, superseded_by, confidence, last_used_ms,
     use_count, tags_json
   ) VALUES (
     ?, ?, ?, ?, '[]',
     'project', NULL, NULL, ?, ?,
     0, '[]'
   )`,
);

interface DecisionRow {
  readonly id: string;
  readonly createdAtMs: number;
  readonly title: string;
  readonly rationale: string;
  readonly confidence: number;
  readonly lastUsedMs: number;
}

const seedAnchorMs = 1_700_000_000_000;

function insertBatch(rows: readonly DecisionRow[]): void {
  ctx.database.transaction(() => {
    for (const row of rows) {
      insertStmt.run(
        row.id,
        row.createdAtMs,
        row.title,
        row.rationale,
        row.confidence,
        row.lastUsedMs,
      );
    }
  });
}

const batchSize = 1_000;
const batch: DecisionRow[] = [];
for (let i = 0; i < CORPUS_SIZE; i += 1) {
  // Quasi-random confidence in [0.4, 1.0] derived from a Lehmer LCG
  // seeded by the index — deterministic across runs so the SLO
  // baseline is stable.
  const seed = (i * 48271) >>> 0;
  const confidence = 0.4 + (seed / 0xffffffff) * 0.6;
  // Back-date last_used_ms by up to 90 days so decay has work to do.
  const ageDays = (seed % 90) + 1;
  const lastUsedMs = seedAnchorMs - ageDays * MS_PER_DAY;
  batch.push({
    id: `bench-decision-${String(i).padStart(6, "0")}`,
    createdAtMs: lastUsedMs,
    title: `Decision ${String(i)}`,
    rationale: `Rationale ${String(i)} for the curator bench pass.`,
    confidence,
    lastUsedMs,
  });
  if (batch.length >= batchSize) {
    insertBatch(batch);
    batch.length = 0;
  }
}
if (batch.length > 0) insertBatch(batch);

const seedMs = performance.now() - seedStart;
console.log(
  `bench F: seeded ${String(CORPUS_SIZE)} decisions in ${seedMs.toFixed(0)}ms`,
);

// Advance the FakeClock so the curator sees the seeded rows as
// "back-dated". The decay calculator's per-day exponent is
// computed against the clock's `now()` minus `lastUsedMs`.
ctx.clock.advance(MS_PER_DAY * 30);

const recorder = registerBench({ name: BENCH_NAME, targetMs: TARGET_MS });

describe("bench / F / curator full pass (50K)", () => {
  bench(
    BENCH_NAME,
    async () => {
      const t0 = performance.now();
      let failed = false;
      let cause = "";
      try {
        await ctx.curator.runCurator.run({
          workspaceId: ctx.workspaceId,
          trigger: CuratorRunTrigger.manual(),
        });
      } catch (err: unknown) {
        failed = true;
        const message = err instanceof Error ? err.message : String(err);
        const code =
          err !== null && typeof err === "object" && "code" in err
            ? String((err as { code?: unknown }).code)
            : "unknown";
        cause = `code=${code}, msg=${message}`;
      }
      const t1 = performance.now();
      if (failed) {
        // Do NOT push to samples — the elapsed time-to-error is not
        // a meaningful latency measurement. The reporter emits an
        // ERROR verdict line instead of a PASS/FAIL one.
        recorder.recordError(
          `curator pass aborted at ${(t1 - t0).toFixed(0)}ms (${cause})`,
        );
        console.log(
          `bench F: curator pass ABORTED at ${(t1 - t0).toFixed(0)}ms (${cause})`,
        );
      } else {
        recorder.record(t1 - t0);
      }
      recorder.markComplete();
    },
    {
      iterations: ITERATIONS,
      time: 0,
      warmupIterations: WARMUP_ITERATIONS,
      warmupTime: 0,
    },
  );
});
