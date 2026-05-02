import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AsyncEmbeddingWorker } from "../../../../src/modules/retrieval/infrastructure/worker/async-embedding-worker.ts";
import type {
  EmbedAndPersistResult,
  EmbedAndPersistUseCase,
} from "../../../../src/modules/retrieval/application/use-cases/embed-and-persist.use-case.ts";
import type { WorkspaceId } from "../../../../src/shared/domain/value-objects/workspace-id.ts";
import { makeWorkspaceId } from "../../../helpers/factories.ts";
import { SilentLogger, RecordingEventPublisher as _unused } from "../../../helpers/test-doubles.ts";

void _unused;

interface DrainCall {
  readonly workspaceId: WorkspaceId;
  readonly batchSize: number;
  readonly backoffWindowMs: number;
}

const emptyResult = (): EmbedAndPersistResult => ({
  processed: [],
  failed: [],
  permanentFailures: [],
  embedderUnavailable: false,
  unavailableRetryAfterMs: null,
  skipped: [],
});

const processedResult = (
  ids: readonly string[],
): EmbedAndPersistResult => ({
  ...emptyResult(),
  processed: ids,
});

const unavailableResult = (
  options: {
    skipped?: readonly string[];
    retryAfterMs?: number | null;
    processed?: readonly string[];
  } = {},
): EmbedAndPersistResult => ({
  ...emptyResult(),
  processed: options.processed ?? [],
  embedderUnavailable: true,
  unavailableRetryAfterMs: options.retryAfterMs ?? null,
  skipped: options.skipped ?? [],
});

class StubUseCase
  implements Pick<EmbedAndPersistUseCase, "drainBatch">
{
  public calls: DrainCall[] = [];
  public results: EmbedAndPersistResult[] = [];
  public error: Error | null = null;

  public drainBatch(input: DrainCall): Promise<EmbedAndPersistResult> {
    this.calls.push(input);
    if (this.error !== null) return Promise.reject(this.error);
    const next = this.results.shift();
    return Promise.resolve(next ?? emptyResult());
  }
}

const newWorker = (
  uc: StubUseCase,
  options: Partial<{
    batchSize: number;
    backoffWindowMs: number;
    idlePollMs: number;
    unavailableBackoffInitialMs: number;
    maxUnavailableBackoffMs: number;
  }> = {},
): AsyncEmbeddingWorker =>
  new AsyncEmbeddingWorker(uc as unknown as EmbedAndPersistUseCase, {
    workspaceId: makeWorkspaceId(),
    batchSize: options.batchSize,
    backoffWindowMs: options.backoffWindowMs,
    idlePollMs: options.idlePollMs,
    unavailableBackoffInitialMs: options.unavailableBackoffInitialMs,
    maxUnavailableBackoffMs: options.maxUnavailableBackoffMs,
    logger: new SilentLogger(),
  });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("AsyncEmbeddingWorker", () => {
  it("start() schedules a drain on the next tick", async () => {
    const uc = new StubUseCase();
    const worker = newWorker(uc);

    worker.start();
    expect(uc.calls.length).toBe(0); // first drain not yet scheduled

    await vi.advanceTimersByTimeAsync(0);
    // Allow the scheduled microtask + the await embedded in runDrain to flush.
    await vi.advanceTimersByTimeAsync(0);

    expect(uc.calls.length).toBeGreaterThanOrEqual(1);
    await worker.stop();
  });

  it("polls idlePollMs between empty drains", async () => {
    const uc = new StubUseCase();
    const worker = newWorker(uc, { idlePollMs: 200 });

    worker.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(uc.calls.length).toBe(1);

    // Empty result → next drain delayed by 200 ms.
    await vi.advanceTimersByTimeAsync(199);
    expect(uc.calls.length).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(uc.calls.length).toBe(2);

    await worker.stop();
  });

  it("immediately re-drains when there is work (processedCount > 0)", async () => {
    const uc = new StubUseCase();
    uc.results = [
      processedResult(["q1"]),
      processedResult(["q2"]),
      emptyResult(),
    ];
    const worker = newWorker(uc, { idlePollMs: 5_000 });

    worker.start();
    // Flush a couple of microtask-and-timer cycles so the recursive
    // setTimeout(0) chain runs at least twice while the queue is hot.
    await vi.runOnlyPendingTimersAsync();
    await vi.runOnlyPendingTimersAsync();
    await vi.runOnlyPendingTimersAsync();

    // With idlePoll at 5 s and only ~0 ms simulated, repeated drains
    // can only happen via the hot-path zero-delay scheduling.
    expect(uc.calls.length).toBeGreaterThanOrEqual(2);

    await worker.stop();
  });

  it("uses default batchSize=32 and default backoffWindowMs=30000", async () => {
    const uc = new StubUseCase();
    const worker = newWorker(uc);

    worker.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(uc.calls[0]?.batchSize).toBe(32);
    expect(uc.calls[0]?.backoffWindowMs).toBe(30_000);

    await worker.stop();
  });

  it("respects injected batchSize and backoffWindowMs options", async () => {
    const uc = new StubUseCase();
    const worker = newWorker(uc, { batchSize: 4, backoffWindowMs: 1234 });

    worker.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(uc.calls[0]?.batchSize).toBe(4);
    expect(uc.calls[0]?.backoffWindowMs).toBe(1234);

    await worker.stop();
  });

  it("recovers from a thrown drain (logs error, continues polling)", async () => {
    const uc = new StubUseCase();
    uc.error = new Error("DB lock");
    const worker = newWorker(uc, { idlePollMs: 100 });

    worker.start();
    await vi.runOnlyPendingTimersAsync();
    const callsBefore = uc.calls.length;
    expect(callsBefore).toBeGreaterThanOrEqual(1);

    // Worker re-schedules anyway after the thrown drain.
    uc.error = null;
    await vi.advanceTimersByTimeAsync(100);
    await vi.runOnlyPendingTimersAsync();
    expect(uc.calls.length).toBeGreaterThan(callsBefore);

    await worker.stop();
  });

  it("recovers from a non-Error rejection (covers String() coercion path)", async () => {
    const uc = new StubUseCase();
    // Reject with a primitive, NOT an Error instance — this exercises
    // the `String(cause)` branch of the worker's logger payload.
    uc.error = "synthetic-string-rejection" as unknown as Error;
    const worker = newWorker(uc, { idlePollMs: 100 });

    worker.start();
    await vi.runOnlyPendingTimersAsync();
    expect(uc.calls.length).toBeGreaterThanOrEqual(1);

    await worker.stop();
  });

  it("start() is a no-op when already running", async () => {
    const uc = new StubUseCase();
    const worker = newWorker(uc);

    worker.start();
    worker.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(uc.calls.length).toBe(1);

    await worker.stop();
  });

  it("stop() awaits the in-flight drain and clears the timer", async () => {
    const uc = new StubUseCase();
    const worker = newWorker(uc);

    worker.start();
    await vi.advanceTimersByTimeAsync(0);
    const beforeStop = uc.calls.length;

    await worker.stop();
    // After stop, no more drains should be scheduled.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(uc.calls.length).toBe(beforeStop);
  });

  it("stop() called twice is idempotent", async () => {
    const uc = new StubUseCase();
    const worker = newWorker(uc);

    worker.start();
    await vi.advanceTimersByTimeAsync(0);
    await worker.stop();
    await expect(worker.stop()).resolves.toBeUndefined();
  });

  it("stop() before start is a no-op", async () => {
    const uc = new StubUseCase();
    const worker = newWorker(uc);
    await expect(worker.stop()).resolves.toBeUndefined();
    expect(uc.calls.length).toBe(0);
  });

  it("does not re-schedule once stopped (running flag respected)", async () => {
    const uc = new StubUseCase();
    uc.results = [processedResult(["q1"])];
    const worker = newWorker(uc, { idlePollMs: 50 });

    worker.start();
    await vi.advanceTimersByTimeAsync(0);
    await worker.stop();

    // Even with hot results, no further drains after stop.
    await vi.advanceTimersByTimeAsync(1000);
    const totalAfter = uc.calls.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(uc.calls.length).toBe(totalAfter);
  });

  // ─── B-MCP-7: back-off on embedderUnavailable ─────────────────────────

  describe("embedderUnavailable back-off (B-MCP-7)", () => {
    it("waits the configured initial back-off after a single unavailable batch", async () => {
      const uc = new StubUseCase();
      uc.results = [
        unavailableResult({ skipped: ["a", "b"] }),
        emptyResult(),
      ];
      const worker = newWorker(uc, {
        idlePollMs: 200,
        unavailableBackoffInitialMs: 1_000,
      });

      worker.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(uc.calls.length).toBe(1);

      // After the unavailable batch the worker MUST wait 1 000 ms (NOT
      // the 200 ms idle poll). Verify the next drain is gated.
      await vi.advanceTimersByTimeAsync(999);
      expect(uc.calls.length).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(uc.calls.length).toBe(2);

      await worker.stop();
    });

    it("doubles the back-off on consecutive unavailable batches", async () => {
      const uc = new StubUseCase();
      uc.results = [
        unavailableResult(), // call 1 → wait 1000 ms
        unavailableResult(), // call 2 → wait 2000 ms
        unavailableResult(), // call 3 → wait 4000 ms
        emptyResult(),
      ];
      const worker = newWorker(uc, {
        idlePollMs: 200,
        unavailableBackoffInitialMs: 1_000,
        maxUnavailableBackoffMs: 60_000,
      });

      worker.start();
      // First drain (call 1) — runs immediately.
      await vi.advanceTimersByTimeAsync(0);
      expect(uc.calls.length).toBe(1);

      // Wait 1 000 ms → call 2 fires.
      await vi.advanceTimersByTimeAsync(1_000);
      expect(uc.calls.length).toBe(2);

      // Wait 2 000 ms → call 3 fires.
      await vi.advanceTimersByTimeAsync(2_000);
      expect(uc.calls.length).toBe(3);

      // Wait 4 000 ms → call 4 fires (this one returns empty result).
      await vi.advanceTimersByTimeAsync(4_000);
      expect(uc.calls.length).toBe(4);

      await worker.stop();
    });

    it("caps the exponential back-off at maxUnavailableBackoffMs", async () => {
      const uc = new StubUseCase();
      // Pile up enough unavailable results that the exponential schedule
      // would exceed the cap (initial 1 000, max 5 000 → caps at call 4).
      uc.results = Array.from({ length: 8 }, () => unavailableResult());
      const worker = newWorker(uc, {
        unavailableBackoffInitialMs: 1_000,
        maxUnavailableBackoffMs: 5_000,
      });

      worker.start();
      await vi.advanceTimersByTimeAsync(0); // call 1
      await vi.advanceTimersByTimeAsync(1_000); // call 2 (1 000 ms back-off)
      await vi.advanceTimersByTimeAsync(2_000); // call 3 (2 000 ms back-off)
      await vi.advanceTimersByTimeAsync(4_000); // call 4 (would be 4 000 ms; under cap)
      // From here every back-off should be capped at 5 000 ms.
      const callsBeforeCap = uc.calls.length;
      await vi.advanceTimersByTimeAsync(4_999);
      expect(uc.calls.length).toBe(callsBeforeCap);
      await vi.advanceTimersByTimeAsync(1);
      expect(uc.calls.length).toBe(callsBeforeCap + 1);

      await worker.stop();
    });

    it("prefers the use case's per-call retry hint over exponential schedule", async () => {
      const uc = new StubUseCase();
      uc.results = [
        unavailableResult({ retryAfterMs: 4_000 }),
        emptyResult(),
      ];
      const worker = newWorker(uc, {
        unavailableBackoffInitialMs: 1_000,
      });

      worker.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(uc.calls.length).toBe(1);

      // 1 000 ms (initial back-off) is NOT enough — the hint asked for
      // 4 000 ms.
      await vi.advanceTimersByTimeAsync(3_999);
      expect(uc.calls.length).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(uc.calls.length).toBe(2);

      await worker.stop();
    });

    it("resets the back-off streak after a recovered batch", async () => {
      const uc = new StubUseCase();
      uc.results = [
        unavailableResult(), // burns 1 attempt → back-off 1 000 ms
        unavailableResult(), // burns 2nd → back-off 2 000 ms
        emptyResult(), // recovers
        unavailableResult(), // back-off should be 1 000 ms again, NOT 4 000 ms
        emptyResult(),
      ];
      const worker = newWorker(uc, {
        idlePollMs: 200,
        unavailableBackoffInitialMs: 1_000,
      });

      worker.start();
      await vi.advanceTimersByTimeAsync(0); // call 1
      await vi.advanceTimersByTimeAsync(1_000); // call 2 (1 000 ms)
      await vi.advanceTimersByTimeAsync(2_000); // call 3 (2 000 ms) → recovers
      // Recovered batch returned empty processed → idle poll (200 ms).
      await vi.advanceTimersByTimeAsync(200); // call 4 (idle poll, unavailable again)
      // After call 4 (unavailable), streak reset means initial 1 000 ms.
      await vi.advanceTimersByTimeAsync(999);
      expect(uc.calls.length).toBe(4);
      await vi.advanceTimersByTimeAsync(1);
      expect(uc.calls.length).toBe(5);

      await worker.stop();
    });
  });
});
