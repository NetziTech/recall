/**
 * Integration test — Flow L: AsyncEmbeddingWorker drains the queue.
 *
 * Regression for Bug B-MCP-3 (https://github.com/NetziTech/recall/issues/2):
 * the worker class was implemented and unit-tested at 100% but no
 * production code path instantiated it. Wire-up moved into
 * `buildRetrievalWiring`, so every container exposes
 * `retrieval.embeddingWorker`; this test asserts the contract end-to-end
 * with a stub embedder so it never touches fastembed.
 *
 * Methodology — VALUES, not SHAPE (Phase-9 lesson):
 *   1. Establish known state: `embedding_queue` has zero rows.
 *   2. Invoke the recording use cases (one decision + one learning +
 *      one entity). Assert the queue grew to exactly three rows and
 *      `embedding_metadata` is still empty.
 *   3. Start the worker. Poll until the queue drops to zero (cap at
 *      ~5 s; the stub embedder is in-process and the idle poll is
 *      200 ms, so the actual wall time is well under 1 s).
 *   4. Assert the side table `embedding_metadata` now has one row per
 *      enqueued memory, with the correct dimension, and that the stub
 *      embedder was invoked.
 *   5. Stop the worker — `stop()` must be idempotent and must await
 *      any in-flight drain before returning.
 *
 * Why this catches B-MCP-3: the test fails if `embeddingWorker` is not
 * wired (the field is missing) AND if the worker fails to drain (the
 * poll times out and the side table stays empty). Both branches
 * reproduce the production symptom that escaped the MVP suite.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Tags } from "../../src/shared/domain/value-objects/tags.ts";
import { EntityKind } from "../../src/modules/memory/domain/value-objects/entity-kind.ts";
import { LearningSeverity } from "../../src/modules/memory/domain/value-objects/learning-severity.ts";
import { Scope } from "../../src/modules/memory/domain/value-objects/scope.ts";
import {
  buildTestContainer,
  type TestContainer,
} from "./_helpers/build-test-container.ts";

interface QueueRow {
  readonly id: string;
  readonly target_kind: string;
}

interface MetadataRow {
  readonly target_kind: string;
  readonly target_row_id: string;
  readonly embedded_text: string;
  readonly dimension: number;
}

function readQueueRows(ctx: TestContainer): QueueRow[] {
  const stmt = ctx.database.prepare(
    "SELECT id, target_kind FROM embedding_queue ORDER BY enqueued_at_ms ASC",
  );
  return [...(stmt.all() as readonly QueueRow[])];
}

function readMetadataRows(ctx: TestContainer): MetadataRow[] {
  const stmt = ctx.database.prepare(
    "SELECT target_kind, target_row_id, embedded_text, dimension FROM embedding_metadata ORDER BY created_at_ms ASC",
  );
  return [...(stmt.all() as readonly MetadataRow[])];
}

async function waitForQueueDrain(
  ctx: TestContainer,
  options: { readonly timeoutMs?: number; readonly pollMs?: number } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 5_000;
  const pollMs = options.pollMs ?? 50;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (readQueueRows(ctx).length === 0) return;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  const remaining = readQueueRows(ctx);
  throw new Error(
    `embedding queue did not drain within ${timeoutMs}ms; remaining=${JSON.stringify(remaining)}`,
  );
}

describe("integration / L / AsyncEmbeddingWorker drains the queue (B-MCP-3)", () => {
  let ctx: TestContainer;

  beforeEach(async () => {
    ctx = await buildTestContainer();
  });

  afterEach(async () => {
    // Stop is idempotent. We call it here in case a test errored
    // between `start()` and its own `stop()` call so the timer
    // does not leak into the next test.
    await ctx.retrieval.embeddingWorker.stop();
    await ctx.cleanup();
  });

  it("exposes the worker on the retrieval wiring", () => {
    expect(ctx.retrieval.embeddingWorker).toBeDefined();
    expect(typeof ctx.retrieval.embeddingWorker.start).toBe("function");
    expect(typeof ctx.retrieval.embeddingWorker.stop).toBe("function");
  });

  it("drains a queue of three mixed-kind enqueues into embedding_metadata", async () => {
    expect(readQueueRows(ctx)).toHaveLength(0);
    expect(readMetadataRows(ctx)).toHaveLength(0);

    const decision = await ctx.memory.recordDecision.record({
      workspaceId: ctx.workspaceId,
      sessionId: null,
      title: "Adopt strict GitFlow on @netzi/recall repo",
      rationale:
        "Public homepage from npm needed a working repo URL; strict GitFlow enforces that main only ever ships through CI-validated PRs.",
      tags: Tags.create(["governance", "release"]),
      scope: Scope.project(),
    });
    expect(decision.embeddingEnqueued).toBe(true);

    const learning = await ctx.memory.recordLearning.record({
      workspaceId: ctx.workspaceId,
      text: "Validate VALUES of MCP tool responses, not just SHAPE — the MVP suite let three production bugs escape because it asserted shapes only.",
      severity: LearningSeverity.critical(),
      tags: Tags.create(["testing", "regression"]),
      scope: Scope.project(),
    });
    expect(learning.embeddingEnqueued).toBe(true);

    const entity = await ctx.memory.recordEntity.record({
      workspaceId: ctx.workspaceId,
      name: "AsyncEmbeddingWorker",
      kind: EntityKind.moduleKind(),
      description:
        "Background worker that drains embedding_queue. Owned by retrieval/infrastructure; lifecycle owned by the bootstrap entrypoint.",
      tags: Tags.create(["retrieval", "background"]),
      scope: Scope.project(),
    });
    expect(entity.embeddingEnqueued).toBe(true);

    // Pre-condition for the value assertion below: queue grew to 3.
    const queueBefore = readQueueRows(ctx);
    expect(queueBefore).toHaveLength(3);
    expect(queueBefore.map((r) => r.target_kind).sort()).toEqual([
      "decision",
      "entity",
      "learning",
    ]);
    // The stub embedder has not been invoked by the worker yet; the
    // recording use cases never call embed themselves.
    expect(ctx.embedder.calls).toHaveLength(0);
    expect(readMetadataRows(ctx)).toHaveLength(0);

    ctx.retrieval.embeddingWorker.start();
    await waitForQueueDrain(ctx);

    // Post-conditions: queue empty, metadata grew by 3, stub recorded
    // exactly one embed per enqueue, and the dimension matches the
    // stub's contract (384, the BGESmallEN15 dim).
    expect(readQueueRows(ctx)).toHaveLength(0);
    const metadata = readMetadataRows(ctx);
    expect(metadata).toHaveLength(3);
    const persistedKinds = metadata.map((r) => r.target_kind).sort();
    expect(persistedKinds).toEqual(["decision", "entity", "learning"]);
    for (const row of metadata) {
      expect(row.dimension).toBe(384);
      expect(row.embedded_text.length).toBeGreaterThan(0);
    }
    expect(ctx.embedder.calls.length).toBeGreaterThanOrEqual(3);

    await ctx.retrieval.embeddingWorker.stop();
    // `stop()` is idempotent — calling it twice must not throw.
    await ctx.retrieval.embeddingWorker.stop();
  });

  it("survives a transient embedder failure without dropping the queue row", async () => {
    // First embed fails; subsequent calls succeed. The worker is
    // expected to log a warning and leave the row in the queue with
    // an incremented failure record. We assert narrowly: the stub
    // got called (proves the worker actually ran) and the queue row
    // is NOT silently dropped — it stays parked in the queue waiting
    // for the next iteration after the backoff window. This guards
    // the "fail-and-forget" anti-pattern that would re-introduce
    // B-MCP-3-style data loss for items the embedder rejected once.
    ctx.embedder.failNext = true;
    const learning = await ctx.memory.recordLearning.record({
      workspaceId: ctx.workspaceId,
      text: "Worker survives transient embed failures.",
      severity: LearningSeverity.tip(),
      tags: Tags.create(["resilience"]),
      scope: Scope.project(),
    });
    expect(learning.embeddingEnqueued).toBe(true);
    expect(readQueueRows(ctx)).toHaveLength(1);

    ctx.retrieval.embeddingWorker.start();
    // Give the worker enough time to attempt the drain at least once.
    // The stub's `failNext` is consumed on the first call, so any
    // subsequent retry within the backoff window would also need to
    // succeed — but the worker honours the 30 s default backoff so
    // we do not assert the row was processed here, only that it was
    // attempted and not dropped.
    const deadline = Date.now() + 1_000;
    while (Date.now() < deadline && ctx.embedder.calls.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(ctx.embedder.calls.length).toBeGreaterThanOrEqual(1);
    // The row stays in the queue — the failure is recorded on it,
    // not dropped.
    expect(readQueueRows(ctx)).toHaveLength(1);
    expect(readMetadataRows(ctx)).toHaveLength(0);

    await ctx.retrieval.embeddingWorker.stop();
  });
});
