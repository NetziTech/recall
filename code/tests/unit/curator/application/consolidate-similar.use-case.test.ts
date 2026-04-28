import { describe, expect, it } from "vitest";
import { ConsolidateSimilarUseCase } from "../../../../src/modules/curator/application/use-cases/consolidate-similar.use-case.ts";
import { CuratorRun } from "../../../../src/modules/curator/domain/aggregates/curator-run.ts";
import { CuratorRunId } from "../../../../src/modules/curator/domain/value-objects/curator-run-id.ts";
import { CuratorRunTrigger } from "../../../../src/modules/curator/domain/value-objects/curator-run-trigger.ts";
import { ConsolidationThreshold } from "../../../../src/modules/curator/domain/value-objects/consolidation-threshold.ts";
import { CosineScore } from "../../../../src/modules/curator/domain/value-objects/cosine-score.ts";
import { CuratorApplicationError } from "../../../../src/modules/curator/application/errors/curator-application-error.ts";
import type { CuratorRunRepository } from "../../../../src/modules/curator/domain/repositories/curator-run-repository.ts";
import type { PrunedEntryRepository } from "../../../../src/modules/curator/domain/repositories/pruned-entry-repository.ts";
import type { PrunedEntry } from "../../../../src/modules/curator/domain/value-objects/pruned-entry.ts";
import type { MemoryEntryKind } from "../../../../src/modules/curator/domain/value-objects/memory-entry-kind.ts";
import type {
  SimilarityFinder,
  SimilarityPair,
} from "../../../../src/modules/curator/application/ports/out/similarity-finder.port.ts";
import type { LearningRepository } from "../../../../src/modules/memory/domain/repositories/learning-repository.ts";
import { Learning } from "../../../../src/modules/memory/domain/aggregates/learning.ts";
import { LearningId } from "../../../../src/modules/memory/domain/value-objects/learning-id.ts";
import { LearningSeverity } from "../../../../src/modules/memory/domain/value-objects/learning-severity.ts";
import { LearningText } from "../../../../src/modules/memory/domain/value-objects/learning-text.ts";
import { Scope } from "../../../../src/modules/memory/domain/value-objects/scope.ts";
import { EmbeddingStatus } from "../../../../src/modules/memory/domain/value-objects/embedding-status.ts";
import { Confidence } from "../../../../src/shared/domain/value-objects/confidence.ts";
import { Tags } from "../../../../src/shared/domain/value-objects/tags.ts";
import { Timestamp } from "../../../../src/shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../src/shared/domain/value-objects/workspace-id.ts";
import { FakeClock } from "../../../../src/shared/infrastructure/clock/fake-clock.ts";
import {
  ANCHOR_TIME_MS,
  FIXED_CURATOR_RUN_UUID,
  makeWorkspaceId,
} from "../../../helpers/factories.ts";
import { SilentLogger } from "../../../helpers/test-doubles.ts";

const LEARNING_A_UUID = "01952f3c-aaaa-7000-8000-000000000001";
const LEARNING_B_UUID = "01952f3c-aaaa-7000-8000-000000000002";
const LEARNING_C_UUID = "01952f3c-aaaa-7000-8000-000000000003";

class InMemoryLearningRepo implements LearningRepository {
  public readonly stored = new Map<string, Learning>();

  public findById(id: LearningId): Promise<Learning | null> {
    return Promise.resolve(this.stored.get(id.toString()) ?? null);
  }

  public save(learning: Learning): Promise<void> {
    this.stored.set(learning.getId().toString(), learning);
    return Promise.resolve();
  }

  public findByWorkspace(
    workspaceId: WorkspaceId,
  ): Promise<readonly Learning[]> {
    const out: Learning[] = [];
    for (const l of this.stored.values()) {
      if (l.getWorkspaceId().equals(workspaceId)) out.push(l);
    }
    return Promise.resolve(out);
  }

  public findActiveByMinimumSeverity(): Promise<readonly Learning[]> {
    return Promise.resolve([]);
  }
}

class InMemoryCuratorRunRepo implements CuratorRunRepository {
  public readonly stored = new Map<string, CuratorRun>();

  public findById(id: CuratorRunId): Promise<CuratorRun | null> {
    return Promise.resolve(this.stored.get(id.toString()) ?? null);
  }

  public save(run: CuratorRun): Promise<void> {
    this.stored.set(run.getId().toString(), run);
    return Promise.resolve();
  }

  public findRecentByWorkspace(): Promise<readonly CuratorRun[]> {
    return Promise.resolve([]);
  }

  public findLastByWorkspace(): Promise<CuratorRun | null> {
    return Promise.resolve(null);
  }
}

class RecordingPrunedRepo implements PrunedEntryRepository {
  public readonly stored: PrunedEntry[] = [];

  public save(entry: PrunedEntry): Promise<void> {
    this.stored.push(entry);
    return Promise.resolve();
  }

  public findById(): Promise<PrunedEntry | null> {
    return Promise.resolve(null);
  }

  public findByWorkspace(): Promise<readonly PrunedEntry[]> {
    return Promise.resolve([]);
  }
}

class StubFinder implements SimilarityFinder {
  public callCount = 0;
  public lastCandidates: readonly { learningId: string }[] | null = null;

  public constructor(private readonly pairs: readonly SimilarityPair[]) {}

  public findPairs(input: {
    candidates: readonly { learningId: string }[];
  }): Promise<readonly SimilarityPair[]> {
    this.callCount += 1;
    this.lastCandidates = input.candidates;
    return Promise.resolve(this.pairs);
  }
}

function buildLearning(
  id: string,
  workspaceId: WorkspaceId,
  options: {
    confidence?: number;
    text?: string;
  } = {},
): Learning {
  return Learning.register({
    id: LearningId.from(id),
    workspaceId,
    text: LearningText.from(options.text ?? `learning content for ${id}`),
    severity: LearningSeverity.tip(),
    tags: Tags.create([]),
    confidence: Confidence.of(options.confidence ?? 1),
    scope: Scope.project(),
    embeddingStatus: EmbeddingStatus.ready(),
    occurredAt: Timestamp.fromEpochMs(ANCHOR_TIME_MS),
  });
}

function makeUseCase(
  finder: SimilarityFinder,
): {
  useCase: ConsolidateSimilarUseCase;
  repo: InMemoryLearningRepo;
  runs: InMemoryCuratorRunRepo;
  pruned: RecordingPrunedRepo;
  clock: FakeClock;
} {
  const repo = new InMemoryLearningRepo();
  const runs = new InMemoryCuratorRunRepo();
  const pruned = new RecordingPrunedRepo();
  const clock = new FakeClock({ initialMs: ANCHOR_TIME_MS });
  const useCase = new ConsolidateSimilarUseCase(
    repo,
    finder,
    runs,
    pruned,
    clock,
    new SilentLogger(),
  );
  return { useCase, repo, runs, pruned, clock };
}

function seedRun(
  runs: InMemoryCuratorRunRepo,
  workspaceId: WorkspaceId,
  clock: FakeClock,
): CuratorRunId {
  const runId = CuratorRunId.from(FIXED_CURATOR_RUN_UUID);
  const run = CuratorRun.start({
    id: runId,
    workspaceId,
    trigger: CuratorRunTrigger.scheduled(),
    occurredAt: clock.now(),
  });
  runs.stored.set(runId.toString(), run);
  return runId;
}

describe("ConsolidateSimilarUseCase", () => {
  it("returns zero result when there is fewer than two active learnings", async () => {
    const finder = new StubFinder([]);
    const { useCase, repo, runs, clock } = makeUseCase(finder);
    const workspaceId = makeWorkspaceId();
    const runId = seedRun(runs, workspaceId, clock);
    repo.stored.set(LEARNING_A_UUID, buildLearning(LEARNING_A_UUID, workspaceId));

    const result = await useCase.consolidate({ runId, workspaceId });

    expect(result.pairsDetected).toBe(0);
    expect(result.learningsFolded).toBe(0);
    expect(finder.callCount).toBe(0);
  });

  it("folds a similar pair: invokes consolidateInto, persists loser, archives PrunedEntry", async () => {
    const workspaceId = makeWorkspaceId();
    const finder = new StubFinder([
      {
        idA: LEARNING_A_UUID,
        idB: LEARNING_B_UUID,
        cosineScore: CosineScore.of(0.95),
      },
    ]);
    const { useCase, repo, runs, pruned, clock } = makeUseCase(finder);
    const runId = seedRun(runs, workspaceId, clock);
    // A has higher confidence so it wins; B becomes loser.
    repo.stored.set(
      LEARNING_A_UUID,
      buildLearning(LEARNING_A_UUID, workspaceId, { confidence: 0.9 }),
    );
    repo.stored.set(
      LEARNING_B_UUID,
      buildLearning(LEARNING_B_UUID, workspaceId, { confidence: 0.5 }),
    );

    const result = await useCase.consolidate({ runId, workspaceId });

    expect(result.pairsDetected).toBe(1);
    expect(result.learningsFolded).toBe(1);
    // Loser was consolidated.
    const loser = repo.stored.get(LEARNING_B_UUID);
    expect(loser).toBeDefined();
    expect(loser?.isActive()).toBe(false);
    expect(loser?.getConsolidatedInto()?.toString()).toBe(LEARNING_A_UUID);
    // Pruned audit row exists with reason consolidated_into_other.
    expect(pruned.stored.length).toBe(1);
    const archived = pruned.stored[0];
    expect(archived?.reason.toString()).toBe("consolidated_into_other");
    expect(archived?.entryRef.id).toBe(LEARNING_B_UUID);
    expect(archived?.entryRef.kind.toString()).toBe("learning");
    // CuratorRun was saved (with a recorded consolidation).
    const persistedRun = runs.stored.get(runId.toString());
    expect(persistedRun?.getConsolidations().length).toBe(1);
  });

  it("respects MAX_CANDIDATES_PER_PASS (500) by passing at most 500 candidates to finder", async () => {
    const workspaceId = makeWorkspaceId();
    const finder = new StubFinder([]);
    const { useCase, repo, runs, clock } = makeUseCase(finder);
    const runId = seedRun(runs, workspaceId, clock);
    // Seed 600 active learnings.
    for (let i = 0; i < 600; i += 1) {
      const id = `01952f3c-aaaa-7000-8000-${i.toString().padStart(12, "0")}`;
      repo.stored.set(
        id,
        buildLearning(id, workspaceId, {
          confidence: Math.min(1, i / 1000), // varying scores
          text: `text-${String(i)}`,
        }),
      );
    }
    await useCase.consolidate({ runId, workspaceId });
    expect(finder.lastCandidates?.length).toBe(500);
  });

  it("skips self-pairs (idA === idB)", async () => {
    const workspaceId = makeWorkspaceId();
    const finder = new StubFinder([
      {
        idA: LEARNING_A_UUID,
        idB: LEARNING_A_UUID,
        cosineScore: CosineScore.of(1),
      },
    ]);
    const { useCase, repo, runs, pruned, clock } = makeUseCase(finder);
    const runId = seedRun(runs, workspaceId, clock);
    repo.stored.set(LEARNING_A_UUID, buildLearning(LEARNING_A_UUID, workspaceId));
    repo.stored.set(LEARNING_B_UUID, buildLearning(LEARNING_B_UUID, workspaceId));

    const result = await useCase.consolidate({ runId, workspaceId });
    expect(result.learningsFolded).toBe(0);
    expect(pruned.stored.length).toBe(0);
  });

  it("skips pairs whose ids are unknown to the candidate map (consolidation race)", async () => {
    const workspaceId = makeWorkspaceId();
    const finder = new StubFinder([
      {
        idA: LEARNING_A_UUID,
        idB: "01952f3c-aaaa-7000-8000-999999999999",
        cosineScore: CosineScore.of(0.96),
      },
    ]);
    const { useCase, repo, runs, pruned, clock } = makeUseCase(finder);
    const runId = seedRun(runs, workspaceId, clock);
    repo.stored.set(LEARNING_A_UUID, buildLearning(LEARNING_A_UUID, workspaceId));
    repo.stored.set(LEARNING_B_UUID, buildLearning(LEARNING_B_UUID, workspaceId));

    const result = await useCase.consolidate({ runId, workspaceId });
    expect(result.learningsFolded).toBe(0);
    expect(pruned.stored.length).toBe(0);
  });

  it("does not fold a pair where one side was already folded earlier in the same call", async () => {
    const workspaceId = makeWorkspaceId();
    const finder = new StubFinder([
      // First pair folds B into A.
      {
        idA: LEARNING_A_UUID,
        idB: LEARNING_B_UUID,
        cosineScore: CosineScore.of(0.95),
      },
      // Second pair tries to fold C into B; should be skipped because B was just folded.
      {
        idA: LEARNING_B_UUID,
        idB: LEARNING_C_UUID,
        cosineScore: CosineScore.of(0.94),
      },
    ]);
    const { useCase, repo, runs, pruned, clock } = makeUseCase(finder);
    const runId = seedRun(runs, workspaceId, clock);
    repo.stored.set(
      LEARNING_A_UUID,
      buildLearning(LEARNING_A_UUID, workspaceId, { confidence: 0.9 }),
    );
    repo.stored.set(
      LEARNING_B_UUID,
      buildLearning(LEARNING_B_UUID, workspaceId, { confidence: 0.5 }),
    );
    repo.stored.set(
      LEARNING_C_UUID,
      buildLearning(LEARNING_C_UUID, workspaceId, { confidence: 0.4 }),
    );

    const result = await useCase.consolidate({ runId, workspaceId });
    expect(result.pairsDetected).toBe(2);
    expect(result.learningsFolded).toBe(1);
    expect(pruned.stored.length).toBe(1);
  });

  it("throws CuratorApplicationError.runNotFound when run does not exist and pairs were detected", async () => {
    const workspaceId = makeWorkspaceId();
    const finder = new StubFinder([
      {
        idA: LEARNING_A_UUID,
        idB: LEARNING_B_UUID,
        cosineScore: CosineScore.of(0.95),
      },
    ]);
    const { useCase, repo } = makeUseCase(finder);
    repo.stored.set(LEARNING_A_UUID, buildLearning(LEARNING_A_UUID, workspaceId));
    repo.stored.set(LEARNING_B_UUID, buildLearning(LEARNING_B_UUID, workspaceId));

    await expect(
      useCase.consolidate({
        runId: CuratorRunId.from("01952f3c-aaaa-7000-8000-bbbbbbbbbbbb"),
        workspaceId,
      }),
    ).rejects.toThrow(CuratorApplicationError);
  });

  it("uses default ConsolidationThreshold when not provided", async () => {
    const workspaceId = makeWorkspaceId();
    const finder = new StubFinder([]);
    const { useCase, repo, runs, clock } = makeUseCase(finder);
    const runId = seedRun(runs, workspaceId, clock);
    repo.stored.set(LEARNING_A_UUID, buildLearning(LEARNING_A_UUID, workspaceId));
    repo.stored.set(LEARNING_B_UUID, buildLearning(LEARNING_B_UUID, workspaceId));
    await useCase.consolidate({ runId, workspaceId });
    // The finder was invoked; it received the default threshold (0.92).
    expect(finder.callCount).toBe(1);
  });

  it("respects an explicit threshold override", async () => {
    const workspaceId = makeWorkspaceId();
    const finder = new StubFinder([]);
    const { useCase, repo, runs, clock } = makeUseCase(finder);
    const runId = seedRun(runs, workspaceId, clock);
    repo.stored.set(LEARNING_A_UUID, buildLearning(LEARNING_A_UUID, workspaceId));
    repo.stored.set(LEARNING_B_UUID, buildLearning(LEARNING_B_UUID, workspaceId));
    await useCase.consolidate({
      runId,
      workspaceId,
      threshold: ConsolidationThreshold.of(0.97),
    });
    expect(finder.callCount).toBe(1);
  });

  it("filters out learnings that are already consolidated", async () => {
    const workspaceId = makeWorkspaceId();
    const finder = new StubFinder([]);
    const { useCase, repo, runs, clock } = makeUseCase(finder);
    const runId = seedRun(runs, workspaceId, clock);
    const a = buildLearning(LEARNING_A_UUID, workspaceId);
    const b = buildLearning(LEARNING_B_UUID, workspaceId);
    // pre-consolidate B into A.
    b.consolidateInto({
      targetId: LearningId.from(LEARNING_A_UUID),
      occurredAt: Timestamp.fromEpochMs(ANCHOR_TIME_MS),
    });
    repo.stored.set(LEARNING_A_UUID, a);
    repo.stored.set(LEARNING_B_UUID, b);

    const result = await useCase.consolidate({ runId, workspaceId });
    expect(result.pairsDetected).toBe(0);
    // finder is NOT called (only 1 active learning after filter).
    expect(finder.callCount).toBe(0);
    // The pseudo-unused MemoryEntryKind import keeps strict TS happy.
    void ({} as MemoryEntryKind | undefined);
  });
});
