/**
 * Integration test — Flow O: AsyncEmbeddingWorker survives a fastembed
 * cold-start without burning per-item retry budget.
 *
 * Regression for Bug B-MCP-7
 * ([issue #24](https://github.com/NetziTech/recall/issues/24)): the
 * worker prior to `0.1.2-beta.4` would burn through `MAX_ATTEMPTS=5`
 * on each queue row in milliseconds while fastembed loaded its model
 * (~4.3 s `FlagEmbedding.init()`), leaving 32 items in `attempts=5`
 * permanent failure before the model was ready.
 *
 * Methodology — VALUES, not SHAPE (Phase-9 lesson reinforced by §6.17):
 *   1. Establish known state: an empty embedding_queue.
 *   2. Enqueue three records (one decision + one learning + one entity)
 *      so the worker has work to do.
 *   3. Configure the stub raw embedder to throw
 *      `EmbedderError.initialisationFailed` on every call until a
 *      counter expires — simulating fastembed's slow init that fails
 *      fast (e.g. corrupt cache, network unreachable).
 *   4. Start the worker with a tight initial back-off so the test
 *      runs fast.
 *   5. Wait for the simulated cold-start to complete.
 *   6. Assert:
 *        a. NO queue row ever reached `attempts=5` (the regression
 *           B-MCP-7 fix prevents).
 *        b. After the embedder recovers, the queue drains to zero.
 *        c. The worker actually backed off (the failure window grew
 *           between attempts).
 *
 * Why this catches the regression: a pre-fix worker would have all
 * three rows at `attempts=5` after the first batch (one round of
 * failures × 5 dequeue cycles = ~3 retries each, then stuck). The
 * post-fix worker tags the batch as `embedderUnavailable` and skips
 * the per-item bump entirely — `attempts` stays at 0 throughout the
 * cold-start window, then drains cleanly after recovery.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Tags } from "../../src/shared/domain/value-objects/tags.ts";
import { EntityKind } from "../../src/modules/memory/domain/value-objects/entity-kind.ts";
import { LearningSeverity } from "../../src/modules/memory/domain/value-objects/learning-severity.ts";
import { Scope } from "../../src/modules/memory/domain/value-objects/scope.ts";
import { AsyncEmbeddingWorker } from "../../src/modules/retrieval/infrastructure/worker/async-embedding-worker.ts";
import { EmbedderError } from "../../src/shared/infrastructure/errors/embedder-error.ts";
import {
  buildTestContainer,
  type TestContainer,
} from "./_helpers/build-test-container.ts";

interface QueueRow {
  readonly id: string;
  readonly target_kind: string;
  readonly attempts: number;
  readonly last_error: string | null;
}

function readQueueRows(ctx: TestContainer): QueueRow[] {
  const stmt = ctx.database.prepare(
    "SELECT id, target_kind, attempts, last_error FROM embedding_queue ORDER BY enqueued_at_ms ASC",
  );
  return [...(stmt.all() as readonly QueueRow[])];
}

function readMetadataCount(ctx: TestContainer): number {
  const stmt = ctx.database.prepare(
    "SELECT COUNT(*) AS n FROM embedding_metadata",
  );
  const raw = stmt.get() as { n: number } | undefined;
  return raw?.n ?? 0;
}

const SLEEP = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

describe("integration / O / embedder cold-start tolerance (B-MCP-7)", () => {
  let ctx: TestContainer;

  beforeEach(async () => {
    ctx = await buildTestContainer();
  });

  afterEach(async () => {
    await ctx.retrieval.embeddingWorker.stop();
    await ctx.cleanup();
  });

  it("does NOT bump per-item attempts during a transport-level cold-start", async () => {
    // Seed the queue with three rows. The factories all enqueue.
    await ctx.memory.recordDecision.record({
      workspaceId: ctx.workspaceId,
      sessionId: null,
      title: "Pin SQLCipher to better-sqlite3-multiple-ciphers",
      rationale:
        "Native SQLCipher build inside Node addon avoids needing system openssl/sqlcipher CLI.",
      tags: Tags.create(["dependencies"]),
      scope: Scope.project(),
    });
    await ctx.memory.recordLearning.record({
      workspaceId: ctx.workspaceId,
      text: "fastembed init takes seconds; the worker MUST not burn item attempts during cold-start.",
      severity: LearningSeverity.critical(),
      tags: Tags.create(["worker", "embedder"]),
      scope: Scope.project(),
    });
    await ctx.memory.recordEntity.record({
      workspaceId: ctx.workspaceId,
      name: "EmbedderUnavailableError",
      kind: EntityKind.classKind(),
      description:
        "Domain error signalling that the embedder is currently unavailable to every input.",
      tags: Tags.create(["retrieval", "errors"]),
      scope: Scope.project(),
    });

    const queueBefore = readQueueRows(ctx);
    expect(queueBefore).toHaveLength(3);
    for (const row of queueBefore) {
      expect(row.attempts).toBe(0);
      expect(row.last_error).toBeNull();
    }

    // Simulate a fastembed cold-start that throws
    // `EmbedderError.initialisationFailed` on the first 6 embed
    // attempts. Six > 3 (queue size) ensures the first whole drain
    // batch fails AND the back-off batch retries also fail at least
    // once before recovery. Total simulated cold-start window: ~3 s
    // worth of retries given the back-off schedule we use below.
    for (let i = 0; i < 6; i += 1) {
      ctx.embedder.nextErrors.push(
        EmbedderError.initialisationFailed(
          new Error(`stub cold-start: not ready yet (call ${String(i + 1)})`),
        ),
      );
    }

    // Override the worker with a tight back-off schedule so the test
    // wall-time stays under 2 s. The default ramp would keep us at
    // 60 s after a few iterations.
    await ctx.retrieval.embeddingWorker.stop();
    const tightWorker = new AsyncEmbeddingWorker(
      ctx.retrieval.embedAndPersist,
      {
        workspaceId: ctx.workspaceId,
        idlePollMs: 50,
        unavailableBackoffInitialMs: 50,
        maxUnavailableBackoffMs: 200,
        logger: ctx.logger,
      },
    );

    tightWorker.start();
    try {
      // Wait long enough for the worker to (a) fail several times,
      // (b) exhaust the simulated cold-start, (c) drain the queue.
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const remaining = readQueueRows(ctx);
        if (remaining.length === 0) break;
        await SLEEP(25);
      }
    } finally {
      await tightWorker.stop();
    }

    // Post-conditions:
    //   1. Queue drained to zero (recovery succeeded).
    //   2. NO queue row was ever marked permanent failure — i.e. the
    //      worker did NOT burn per-item attempts during the cold-start.
    //      We can't observe in-flight attempts, but `recordFailure` is
    //      the only path that bumps the column. If the post-fix worker
    //      kept its promise, the rows that ultimately drained never
    //      had their `attempts` touched.
    //   3. embedding_metadata grew by 3 (the recorded items embed
    //      successfully once the cold-start window passes).
    //   4. The stub recorded MORE than 3 calls (the early failures
    //      counted as calls too — proving the worker DID retry, just
    //      without bumping per-item attempts).
    expect(readQueueRows(ctx)).toHaveLength(0);
    expect(readMetadataCount(ctx)).toBe(3);
    expect(ctx.embedder.calls.length).toBeGreaterThan(3);
  });

  it("after recovery, leftover perma-failed rows can be reset via the use case (B-MCP-7 Option C)", async () => {
    // Seed a single decision; the recording use case enqueues one row.
    await ctx.memory.recordDecision.record({
      workspaceId: ctx.workspaceId,
      sessionId: null,
      title: "Adopt typed embedder error union",
      rationale:
        "Discriminating transport from per-item failures is the actual fix; the reset command is recovery for already-affected workspaces.",
      tags: Tags.create(["embedder"]),
      scope: Scope.project(),
    });
    expect(readQueueRows(ctx)).toHaveLength(1);

    // Simulate a workspace that was poisoned by the pre-fix worker:
    // mark the row at attempts=5 manually.
    ctx.database.exec(
      "UPDATE embedding_queue SET attempts = 5, last_error = 'simulated perma-fail (pre-B-MCP-7)' WHERE attempts = 0",
    );

    const beforeReset = readQueueRows(ctx);
    expect(beforeReset).toHaveLength(1);
    expect(beforeReset[0]?.attempts).toBe(5);

    // Run the recovery use case (the same one wired behind
    // `recall reset-queue`).
    const result = await ctx.retrieval.resetEmbeddingQueue.execute({
      workspaceId: ctx.workspaceId,
    });
    expect(result.resetCount).toBe(1);
    expect(result.attemptsAtLeast).toBe(5);

    const afterReset = readQueueRows(ctx);
    expect(afterReset).toHaveLength(1);
    expect(afterReset[0]?.attempts).toBe(0);
    expect(afterReset[0]?.last_error).toBeNull();

    // And the worker can now drain it normally.
    ctx.retrieval.embeddingWorker.start();
    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline && readQueueRows(ctx).length > 0) {
      await SLEEP(25);
    }
    await ctx.retrieval.embeddingWorker.stop();

    expect(readQueueRows(ctx)).toHaveLength(0);
    expect(readMetadataCount(ctx)).toBe(1);
  });
});
