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
    return Promise.resolve(
      next ?? { processed: [], failed: [], permanentFailures: [] },
    );
  }
}

const newWorker = (
  uc: StubUseCase,
  options: Partial<{
    batchSize: number;
    backoffWindowMs: number;
    idlePollMs: number;
  }> = {},
): AsyncEmbeddingWorker =>
  new AsyncEmbeddingWorker(uc as unknown as EmbedAndPersistUseCase, {
    workspaceId: makeWorkspaceId(),
    batchSize: options.batchSize,
    backoffWindowMs: options.backoffWindowMs,
    idlePollMs: options.idlePollMs,
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
      { processed: ["q1"], failed: [], permanentFailures: [] },
      { processed: ["q2"], failed: [], permanentFailures: [] },
      { processed: [], failed: [], permanentFailures: [] },
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
    uc.results = [
      { processed: ["q1"], failed: [], permanentFailures: [] },
    ];
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
});
