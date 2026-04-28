import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntervalCuratorScheduler } from "../../../../src/modules/curator/infrastructure/scheduler/interval-curator-scheduler.ts";
import type { RunCurator } from "../../../../src/modules/curator/application/ports/in/run-curator.port.ts";
import { CuratorRunId } from "../../../../src/modules/curator/domain/value-objects/curator-run-id.ts";
import { CuratorRunStats } from "../../../../src/modules/curator/domain/value-objects/curator-run-stats.ts";
import type { CuratorRunTrigger } from "../../../../src/modules/curator/domain/value-objects/curator-run-trigger.ts";
import { FakeClock } from "../../../../src/shared/infrastructure/clock/fake-clock.ts";
import { ANCHOR_TIME_MS, FIXED_CURATOR_RUN_UUID, makeWorkspaceId } from "../../../helpers/factories.ts";
import { SilentLogger } from "../../../helpers/test-doubles.ts";

class RecordingRunCurator implements RunCurator {
  public readonly calls: Array<{ trigger: CuratorRunTrigger }> = [];
  public delayMs = 0;
  public failNext = false;

  public async run(input: {
    trigger: CuratorRunTrigger;
  }): Promise<{
    runId: CuratorRunId;
    stats: CuratorRunStats;
    findings: readonly never[];
    consolidations: readonly never[];
  }> {
    this.calls.push({ trigger: input.trigger });
    if (this.delayMs > 0) {
      await new Promise<void>((resolve) =>
        setTimeout(resolve, this.delayMs),
      );
    }
    if (this.failNext) {
      this.failNext = false;
      throw new Error("boom");
    }
    return {
      runId: CuratorRunId.from(FIXED_CURATOR_RUN_UUID),
      stats: CuratorRunStats.empty(),
      findings: [],
      consolidations: [],
    };
  }
}

describe("IntervalCuratorScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("start schedules the first tick after intervalMs", async () => {
    const runCurator = new RecordingRunCurator();
    const clock = new FakeClock({ initialMs: ANCHOR_TIME_MS });
    const scheduler = new IntervalCuratorScheduler({
      runCurator,
      workspaceId: makeWorkspaceId(),
      clock,
      logger: new SilentLogger(),
      intervalMs: 1000,
      cooldownMs: 500,
    });
    scheduler.start();
    expect(runCurator.calls.length).toBe(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(runCurator.calls.length).toBe(1);
    scheduler.stop();
  });

  it("start is idempotent (no double scheduling)", async () => {
    const runCurator = new RecordingRunCurator();
    const clock = new FakeClock({ initialMs: ANCHOR_TIME_MS });
    const scheduler = new IntervalCuratorScheduler({
      runCurator,
      workspaceId: makeWorkspaceId(),
      clock,
      logger: new SilentLogger(),
      intervalMs: 1000,
    });
    scheduler.start();
    scheduler.start();
    scheduler.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(runCurator.calls.length).toBe(1);
    scheduler.stop();
  });

  it("stop clears the timer (idempotent)", async () => {
    const runCurator = new RecordingRunCurator();
    const clock = new FakeClock({ initialMs: ANCHOR_TIME_MS });
    const scheduler = new IntervalCuratorScheduler({
      runCurator,
      workspaceId: makeWorkspaceId(),
      clock,
      logger: new SilentLogger(),
      intervalMs: 1000,
    });
    scheduler.start();
    scheduler.stop();
    scheduler.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(runCurator.calls.length).toBe(0);
  });

  it("triggerNow respects cooldown", async () => {
    const runCurator = new RecordingRunCurator();
    const clock = new FakeClock({ initialMs: ANCHOR_TIME_MS });
    const scheduler = new IntervalCuratorScheduler({
      runCurator,
      workspaceId: makeWorkspaceId(),
      clock,
      logger: new SilentLogger(),
      intervalMs: 60_000,
      cooldownMs: 5_000,
    });
    await scheduler.triggerNow();
    expect(runCurator.calls.length).toBe(1);
    // second call within cooldown is suppressed
    await scheduler.triggerNow();
    expect(runCurator.calls.length).toBe(1);
    // advance past cooldown
    clock.advance(5_001);
    await scheduler.triggerNow();
    expect(runCurator.calls.length).toBe(2);
    scheduler.stop();
  });

  it("inflight mutex prevents overlapping runs", async () => {
    const runCurator = new RecordingRunCurator();
    runCurator.delayMs = 100;
    const clock = new FakeClock({ initialMs: ANCHOR_TIME_MS });
    const scheduler = new IntervalCuratorScheduler({
      runCurator,
      workspaceId: makeWorkspaceId(),
      clock,
      logger: new SilentLogger(),
      intervalMs: 50,
      cooldownMs: 0,
    });
    // fire two triggers concurrently — second should be suppressed
    const p1 = scheduler.triggerNow();
    const p2 = scheduler.triggerNow();
    await vi.advanceTimersByTimeAsync(150);
    await Promise.all([p1, p2]);
    expect(runCurator.calls.length).toBe(1);
    scheduler.stop();
  });

  it("scheduled tick logs and continues after a failure", async () => {
    const runCurator = new RecordingRunCurator();
    runCurator.failNext = true;
    const clock = new FakeClock({ initialMs: ANCHOR_TIME_MS });
    const scheduler = new IntervalCuratorScheduler({
      runCurator,
      workspaceId: makeWorkspaceId(),
      clock,
      logger: new SilentLogger(),
      intervalMs: 1000,
    });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(runCurator.calls.length).toBe(1);
    // next tick — runCurator now succeeds (failNext was reset)
    await vi.advanceTimersByTimeAsync(1000);
    expect(runCurator.calls.length).toBe(2);
    scheduler.stop();
  });

  it("triggerNow is a no-op when stopped", async () => {
    const runCurator = new RecordingRunCurator();
    const clock = new FakeClock({ initialMs: ANCHOR_TIME_MS });
    const scheduler = new IntervalCuratorScheduler({
      runCurator,
      workspaceId: makeWorkspaceId(),
      clock,
      logger: new SilentLogger(),
    });
    scheduler.stop();
    await scheduler.triggerNow();
    expect(runCurator.calls.length).toBe(0);
  });

  it("start is a no-op after stop", async () => {
    const runCurator = new RecordingRunCurator();
    const clock = new FakeClock({ initialMs: ANCHOR_TIME_MS });
    const scheduler = new IntervalCuratorScheduler({
      runCurator,
      workspaceId: makeWorkspaceId(),
      clock,
      logger: new SilentLogger(),
      intervalMs: 1000,
    });
    scheduler.stop();
    scheduler.start();
    await vi.advanceTimersByTimeAsync(2000);
    expect(runCurator.calls.length).toBe(0);
  });
});
