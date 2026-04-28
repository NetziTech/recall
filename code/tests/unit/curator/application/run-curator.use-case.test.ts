import { describe, expect, it } from "vitest";
import { RunCuratorUseCase } from "../../../../src/modules/curator/application/use-cases/run-curator.use-case.ts";
import { CuratorRun } from "../../../../src/modules/curator/domain/aggregates/curator-run.ts";
import { CuratorRunId } from "../../../../src/modules/curator/domain/value-objects/curator-run-id.ts";
import { CuratorRunStats } from "../../../../src/modules/curator/domain/value-objects/curator-run-stats.ts";
import { CuratorRunTrigger } from "../../../../src/modules/curator/domain/value-objects/curator-run-trigger.ts";
import type { CuratorRunRepository } from "../../../../src/modules/curator/domain/repositories/curator-run-repository.ts";
import type { ApplyDecay } from "../../../../src/modules/curator/application/ports/in/apply-decay.port.ts";
import type { ConsolidateSimilar } from "../../../../src/modules/curator/application/ports/in/consolidate-similar.port.ts";
import type { SelfHeal } from "../../../../src/modules/curator/application/ports/in/self-heal.port.ts";
import type { PruneLowConfidence } from "../../../../src/modules/curator/application/ports/in/prune-low-confidence.port.ts";
import type { RollupSession } from "../../../../src/modules/curator/application/ports/in/rollup-session.port.ts";
import type { WorkspaceId } from "../../../../src/shared/domain/value-objects/workspace-id.ts";
import { FakeClock } from "../../../../src/shared/infrastructure/clock/fake-clock.ts";
import { FakeIdGenerator } from "../../../../src/shared/infrastructure/id-generator/fake-id-generator.ts";
import { CuratorApplicationError } from "../../../../src/modules/curator/application/errors/curator-application-error.ts";
import {
  ANCHOR_TIME_MS,
  FIXED_CURATOR_RUN_UUID,
  makeWorkspaceId,
} from "../../../helpers/factories.ts";
import { SilentLogger } from "../../../helpers/test-doubles.ts";

const SECOND_RUN_UUID = "01952f3c-2222-7000-8000-aaaaaaaaaaaa";

class InMemoryCuratorRunRepo implements CuratorRunRepository {
  public readonly stored: CuratorRun[] = [];

  public findById(id: CuratorRunId): Promise<CuratorRun | null> {
    return Promise.resolve(
      this.stored.find((r) => r.getId().equals(id)) ?? null,
    );
  }

  public save(run: CuratorRun): Promise<void> {
    const idx = this.stored.findIndex((r) => r.getId().equals(run.getId()));
    if (idx >= 0) this.stored[idx] = run;
    else this.stored.push(run);
    return Promise.resolve();
  }

  public findRecentByWorkspace(
    workspaceId: WorkspaceId,
    limit: number,
  ): Promise<readonly CuratorRun[]> {
    void workspaceId;
    return Promise.resolve(this.stored.slice(0, limit));
  }

  public findLastByWorkspace(
    workspaceId: WorkspaceId,
  ): Promise<CuratorRun | null> {
    void workspaceId;
    return Promise.resolve(this.stored[this.stored.length - 1] ?? null);
  }
}

const noopApplyDecay: ApplyDecay = {
  apply: ({ runId }) =>
    Promise.resolve({
      runId,
      entriesScanned: 10,
      entriesDecayed: 5,
    }),
};

const noopConsolidate: ConsolidateSimilar = {
  consolidate: ({ runId }) =>
    Promise.resolve({
      runId,
      pairsDetected: 0,
      learningsFolded: 0,
    }),
};

const noopSelfHeal: SelfHeal = {
  heal: ({ runId }) =>
    Promise.resolve({
      runId,
      pathsCorrected: 0,
      decisionConflictsDetected: 0,
      embeddingsRequeued: 0,
      openQuestionsAged: 0,
      findingsRecorded: 0,
    }),
};

const noopPrune: PruneLowConfidence = {
  prune: ({ runId }) =>
    Promise.resolve({ runId, entriesPruned: 0 }),
};

const noopRollup: RollupSession = {
  rollup: () =>
    Promise.resolve({
      sessionsClosed: 0,
      summariesGenerated: 0,
      learningsCreated: 0,
    }),
};

function makeUseCase(overrides: {
  applyDecay?: ApplyDecay;
  consolidateSimilar?: ConsolidateSimilar;
  rollupSession?: RollupSession;
  initialMs?: number;
} = {}) {
  const repo = new InMemoryCuratorRunRepo();
  const clock = new FakeClock({
    initialMs: overrides.initialMs ?? ANCHOR_TIME_MS,
  });
  const idGen = new FakeIdGenerator({
    sequence: [FIXED_CURATOR_RUN_UUID, SECOND_RUN_UUID],
  });
  const logger = new SilentLogger();
  const useCase = new RunCuratorUseCase(
    repo,
    overrides.rollupSession ?? noopRollup,
    overrides.applyDecay ?? noopApplyDecay,
    overrides.consolidateSimilar ?? noopConsolidate,
    noopSelfHeal,
    noopPrune,
    idGen,
    clock,
    logger,
  );
  return { useCase, repo, clock };
}

describe("RunCuratorUseCase.run", () => {
  it("happy path: completes a run, sets durationMs", async () => {
    const { useCase, repo, clock } = makeUseCase();
    const result = await useCase.run({
      workspaceId: makeWorkspaceId(),
      trigger: CuratorRunTrigger.scheduled(),
    });
    expect(result.runId.toString()).toBe(FIXED_CURATOR_RUN_UUID);
    expect(repo.stored.length).toBe(1);
    expect(repo.stored[0]?.isCompleted()).toBe(true);
    // entriesScanned/decayed flowed through ApplyDecay
    expect(result.stats.getEntriesScanned()).toBe(10);
    expect(result.stats.getEntriesDecayed()).toBe(5);
    expect(clock.nowMs()).toBeGreaterThanOrEqual(ANCHOR_TIME_MS);
  });

  it("rolls up sessions when trigger is session_close", async () => {
    let rollupCalls = 0;
    const trackedRollup: RollupSession = {
      rollup: () => {
        rollupCalls += 1;
        return Promise.resolve({
          sessionsClosed: 1,
          summariesGenerated: 1,
          learningsCreated: 0,
        });
      },
    };
    const { useCase } = makeUseCase({ rollupSession: trackedRollup });
    await useCase.run({
      workspaceId: makeWorkspaceId(),
      trigger: CuratorRunTrigger.sessionClose(),
    });
    expect(rollupCalls).toBe(1);
  });

  it("does NOT roll up sessions when trigger is scheduled", async () => {
    let rollupCalls = 0;
    const trackedRollup: RollupSession = {
      rollup: () => {
        rollupCalls += 1;
        return Promise.resolve({
          sessionsClosed: 0,
          summariesGenerated: 0,
          learningsCreated: 0,
        });
      },
    };
    const { useCase } = makeUseCase({ rollupSession: trackedRollup });
    await useCase.run({
      workspaceId: makeWorkspaceId(),
      trigger: CuratorRunTrigger.scheduled(),
    });
    expect(rollupCalls).toBe(0);
  });

  it("refuses a new run when one is in flight (not stale)", async () => {
    const { useCase, repo, clock } = makeUseCase();
    // Pre-populate the repo with an in-flight run
    const inflight = CuratorRun.start({
      id: CuratorRunId.from(SECOND_RUN_UUID),
      workspaceId: makeWorkspaceId(),
      trigger: CuratorRunTrigger.scheduled(),
      occurredAt: clock.now(),
    });
    repo.stored.push(inflight);
    // Advance clock by 1 minute (well within 5-min stale threshold)
    clock.advance(60_000);
    await expect(
      useCase.run({
        workspaceId: makeWorkspaceId(),
        trigger: CuratorRunTrigger.scheduled(),
      }),
    ).rejects.toThrow(CuratorApplicationError);
  });

  it("recovers a stale in-flight run (>5min) and starts a new one", async () => {
    const { useCase, repo, clock } = makeUseCase();
    const inflight = CuratorRun.start({
      id: CuratorRunId.from(SECOND_RUN_UUID),
      workspaceId: makeWorkspaceId(),
      trigger: CuratorRunTrigger.scheduled(),
      occurredAt: clock.now(),
    });
    repo.stored.push(inflight);
    // Advance past stale threshold (5 min + 1)
    clock.advance(5 * 60 * 1000 + 1);
    const result = await useCase.run({
      workspaceId: makeWorkspaceId(),
      trigger: CuratorRunTrigger.scheduled(),
    });
    // New run minted
    expect(result.runId.toString()).toBe(FIXED_CURATOR_RUN_UUID);
    // Old run was force-completed
    const oldRun = repo.stored.find((r) =>
      r.getId().equals(CuratorRunId.from(SECOND_RUN_UUID)),
    );
    expect(oldRun?.isCompleted()).toBe(true);
  });

  it("propagates failures from sub-use-cases (run stays in-flight)", async () => {
    const failingDecay: ApplyDecay = {
      apply: () => Promise.reject(new Error("decay boom")),
    };
    const { useCase, repo } = makeUseCase({ applyDecay: failingDecay });
    await expect(
      useCase.run({
        workspaceId: makeWorkspaceId(),
        trigger: CuratorRunTrigger.scheduled(),
      }),
    ).rejects.toThrow("decay boom");
    // The run stays in-flight (not completed)
    expect(repo.stored.length).toBe(1);
    expect(repo.stored[0]?.isCompleted()).toBe(false);
  });

  it("folds learningsConsolidated counter from ConsolidateSimilar", async () => {
    const consolidate: ConsolidateSimilar = {
      consolidate: ({ runId }) =>
        Promise.resolve({ runId, pairsDetected: 7, learningsFolded: 4 }),
    };
    const { useCase } = makeUseCase({ consolidateSimilar: consolidate });
    const result = await useCase.run({
      workspaceId: makeWorkspaceId(),
      trigger: CuratorRunTrigger.scheduled(),
    });
    expect(result.stats.getLearningsConsolidated()).toBe(4);
    void CuratorRunStats; // mark import as used
  });
});
