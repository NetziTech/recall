/**
 * Integration test — Flow K: curator full pass against the real
 * SQLite-backed reader+writer (Bug F regression guard, Tarea 5.4).
 *
 * Why this test exists:
 * - The curator's unit suite mocks `MemoryEntryReader` and
 *   `MemoryEntryWriter`, so it cannot detect the
 *   `better-sqlite3-multiple-ciphers` reentrancy constraint
 *   (`REQUIRE_DATABASE_NO_ITERATORS_UNLESS_UNSAFE`): a write issued on
 *   a connection while a read iterator is still open raises
 *   `TypeError: This database connection is busy executing a query`.
 * - The previous `ApplyDecayUseCase` used
 *   `for await (...of reader.iterateActiveByKind(...))` and called
 *   `writer.applyDecay(...)` inside the loop, which crashed for any
 *   workspace with real data (Tarea 5.4 bench F revealed this).
 * - This test seeds a corpus of decisions + learnings via raw SQL,
 *   runs `RunCuratorUseCase`, and asserts:
 *     1. The pass does NOT throw.
 *     2. Every seeded row's confidence is updated by the decay factor.
 *     3. The orchestrator persists the run with non-zero counters.
 * - The test MUST FAIL before the fix in `apply-decay.use-case.ts`
 *   (the curator throws the busy-connection error) and MUST PASS
 *   after.
 */
import { z } from "zod";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CuratorRunTrigger } from "../../src/modules/curator/domain/value-objects/curator-run-trigger.ts";
import {
  buildTestContainer,
  type TestContainer,
} from "./_helpers/build-test-container.ts";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const SEED_ANCHOR_MS = 1_700_000_000_000;
const CORPUS_SIZE = 100;

const ConfidenceRowSchema = z.object({
  id: z.string().min(1),
  confidence: z.number(),
});
type ConfidenceRow = z.infer<typeof ConfidenceRowSchema>;

interface SeededRow {
  readonly id: string;
  readonly initialConfidence: number;
}

describe("integration / K / curator full pass against real SQLite", () => {
  let ctx: TestContainer;

  beforeEach(async () => {
    ctx = await buildTestContainer();
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it("runs ApplyDecay over decisions+learnings without TypeError 'database busy'", async () => {
    // ── Seed: 100 decisions + 100 learnings, all back-dated 60 days. ──
    const decisionStmt = ctx.database.prepare(
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
    const learningStmt = ctx.database.prepare(
      `INSERT INTO learnings (
         id, created_at_ms, content, trigger, scope, module,
         severity, confidence, last_used_ms, use_count, tags_json,
         consolidated_into
       ) VALUES (
         ?, ?, ?, NULL, 'project', NULL,
         'tip', ?, ?, 0, '[]',
         NULL
       )`,
    );

    const seededDecisions: SeededRow[] = [];
    const seededLearnings: SeededRow[] = [];

    // Mint canonical UUID v7 ids — the memory module's
    // `LearningRepository.findByWorkspace` (called from
    // `ConsolidateSimilarUseCase`) parses every row id through
    // `LearningId.from`, which requires UUID v7. Decisions are not
    // re-hydrated through their aggregate during the curator pass, so
    // the constraint is asymmetric, but minting fresh UUIDs for both
    // keeps the seed code uniform.
    ctx.database.transaction(() => {
      for (let i = 0; i < CORPUS_SIZE; i += 1) {
        const ageDays = (i % 90) + 30;
        const lastUsedMs = SEED_ANCHOR_MS - ageDays * MS_PER_DAY;
        // Confidence in [0.5, 1.0] so the decay calculator has work
        // to do without dropping any row below the prune threshold
        // (we want to assert decay-without-prune in this test).
        const confidence = 0.5 + (i % 50) / 100;
        const decisionId = ctx.idGenerator.generateString();
        const learningId = ctx.idGenerator.generateString();
        decisionStmt.run(
          decisionId,
          lastUsedMs,
          `Decision ${String(i)}`,
          `Rationale ${String(i)}`,
          confidence,
          lastUsedMs,
        );
        learningStmt.run(
          learningId,
          lastUsedMs,
          `Learning content ${String(i)}`,
          confidence,
          lastUsedMs,
        );
        seededDecisions.push({ id: decisionId, initialConfidence: confidence });
        seededLearnings.push({ id: learningId, initialConfidence: confidence });
      }
    });

    // Advance the FakeClock 30 days so the decay calculator sees the
    // seeded rows as back-dated.
    ctx.clock.advance(MS_PER_DAY * 30);

    // ── Act: run the full curator pass.
    const runResult = await ctx.curator.runCurator.run({
      workspaceId: ctx.workspaceId,
      trigger: CuratorRunTrigger.manual(),
    });

    // ── Assert: counters and persistence.
    expect(runResult.stats.getEntriesScanned()).toBeGreaterThanOrEqual(
      CORPUS_SIZE * 2,
    );
    // Every seeded row was decayable (60–120 days old, geometric
    // factor < 1), so the decay count should match the scan count of
    // the kinds with non-unity decay (decisions + learnings).
    expect(runResult.stats.getEntriesDecayed()).toBeGreaterThanOrEqual(
      CORPUS_SIZE * 2,
    );

    // Read back every seeded row and confirm confidence dropped.
    const rowsAfter = ctx.database
      .prepare(`SELECT id, confidence FROM decisions`)
      .all();
    const decisionsAfter = new Map<string, number>();
    for (const raw of rowsAfter) {
      const parsed: ConfidenceRow = ConfidenceRowSchema.parse(raw);
      decisionsAfter.set(parsed.id, parsed.confidence);
    }
    for (const seeded of seededDecisions) {
      const after = decisionsAfter.get(seeded.id);
      expect(after).toBeDefined();
      // After 60+ days of decay, a decision's confidence MUST be
      // strictly below the seeded value (decay factor < 1).
      expect(after as number).toBeLessThan(seeded.initialConfidence);
    }

    const learningRowsAfter = ctx.database
      .prepare(`SELECT id, confidence FROM learnings`)
      .all();
    const learningsAfter = new Map<string, number>();
    for (const raw of learningRowsAfter) {
      const parsed: ConfidenceRow = ConfidenceRowSchema.parse(raw);
      learningsAfter.set(parsed.id, parsed.confidence);
    }
    for (const seeded of seededLearnings) {
      const after = learningsAfter.get(seeded.id);
      expect(after).toBeDefined();
      expect(after as number).toBeLessThan(seeded.initialConfidence);
    }

    // The run itself was persisted with a completed status.
    const persisted = await ctx.curator.curatorRuns.findById(runResult.runId);
    expect(persisted).not.toBeNull();
    expect(persisted?.isCompleted()).toBe(true);
  });
});
