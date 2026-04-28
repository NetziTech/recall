import { describe, expect, it } from "vitest";
import { RecordLearningUseCase } from "../../../../src/modules/memory/application/use-cases/record-learning.use-case.ts";
import type { LearningRepository } from "../../../../src/modules/memory/domain/repositories/learning-repository.ts";
import type {
  EmbeddableKind,
  EmbeddingEnqueuer,
} from "../../../../src/modules/memory/application/ports/out/embedding-enqueuer.port.ts";
import { Learning } from "../../../../src/modules/memory/domain/aggregates/learning.ts";
import type { LearningId } from "../../../../src/modules/memory/domain/value-objects/learning-id.ts";
import { LearningSeverity } from "../../../../src/modules/memory/domain/value-objects/learning-severity.ts";
import { Scope } from "../../../../src/modules/memory/domain/value-objects/scope.ts";
import type { Timestamp } from "../../../../src/shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../src/shared/domain/value-objects/workspace-id.ts";
import { FakeClock } from "../../../../src/shared/infrastructure/clock/fake-clock.ts";
import { FakeIdGenerator } from "../../../../src/shared/infrastructure/id-generator/fake-id-generator.ts";
import { LearningRegistered } from "../../../../src/modules/memory/domain/events/learning-registered.ts";
import { InvalidInputError } from "../../../../src/shared/domain/errors/invalid-input-error.ts";
import {
  ANCHOR_TIME_MS,
  FIXED_LEARNING_UUID,
  makeTags,
  makeWorkspaceId,
} from "../../../helpers/factories.ts";
import {
  RecordingEventPublisher,
  SilentLogger,
} from "../../../helpers/test-doubles.ts";

class InMemoryLearningRepo implements LearningRepository {
  public readonly stored: Learning[] = [];

  public findById(id: LearningId): Promise<Learning | null> {
    const found = this.stored.find((l) => l.getId().equals(id));
    return Promise.resolve(found ?? null);
  }

  public save(learning: Learning): Promise<void> {
    this.stored.push(learning);
    return Promise.resolve();
  }

  public findByWorkspace(): Promise<readonly Learning[]> {
    return Promise.resolve(this.stored);
  }

  public findActiveByMinimumSeverity(): Promise<readonly Learning[]> {
    return Promise.resolve(this.stored);
  }
}

class RecordingEnqueuer implements EmbeddingEnqueuer {
  public readonly calls: Array<{
    workspaceId: WorkspaceId;
    targetKind: EmbeddableKind;
    targetRowId: string;
    enqueuedAt: Timestamp;
  }> = [];
  public failNext = false;

  public enqueue(input: {
    workspaceId: WorkspaceId;
    targetKind: EmbeddableKind;
    targetRowId: string;
    enqueuedAt: Timestamp;
  }): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      return Promise.reject(new Error("enqueue boom"));
    }
    this.calls.push(input);
    return Promise.resolve();
  }
}

function makeUseCase(): {
  useCase: RecordLearningUseCase;
  repo: InMemoryLearningRepo;
  enqueuer: RecordingEnqueuer;
  events: RecordingEventPublisher;
} {
  const repo = new InMemoryLearningRepo();
  const enqueuer = new RecordingEnqueuer();
  const clock = new FakeClock({ initialMs: ANCHOR_TIME_MS });
  const idGen = new FakeIdGenerator({ sequence: [FIXED_LEARNING_UUID] });
  const events = new RecordingEventPublisher();
  const logger = new SilentLogger();
  const useCase = new RecordLearningUseCase(
    repo,
    enqueuer,
    idGen,
    clock,
    events,
    logger,
  );
  return { useCase, repo, enqueuer, events };
}

describe("RecordLearningUseCase.record", () => {
  it("persists, publishes event, and enqueues embedding", async () => {
    const { useCase, repo, enqueuer, events } = makeUseCase();
    const result = await useCase.record({
      workspaceId: makeWorkspaceId(),
      text: "Always trim before comparing paths",
      severity: LearningSeverity.warning(),
      tags: makeTags(["fs"]),
      scope: Scope.project(),
    });
    expect(result.learningId.toString()).toBe(FIXED_LEARNING_UUID);
    expect(result.embeddingEnqueued).toBe(true);
    expect(repo.stored.length).toBe(1);
    expect(repo.stored[0]?.getSeverity().isWarning()).toBe(true);
    expect(enqueuer.calls.length).toBe(1);
    expect(enqueuer.calls[0]?.targetKind).toBe("learning");
    expect(events.published()[0]).toBeInstanceOf(LearningRegistered);
  });

  it("defaults severity to tip when null is passed", async () => {
    const { useCase, repo } = makeUseCase();
    await useCase.record({
      workspaceId: makeWorkspaceId(),
      text: "Tip text here",
      severity: null,
      tags: makeTags(),
      scope: Scope.project(),
    });
    expect(repo.stored[0]?.getSeverity().isTip()).toBe(true);
  });

  it("returns embeddingEnqueued=false when enqueuer fails (entry persists)", async () => {
    const { useCase, repo, enqueuer } = makeUseCase();
    enqueuer.failNext = true;
    const result = await useCase.record({
      workspaceId: makeWorkspaceId(),
      text: "Some text",
      severity: null,
      tags: makeTags(),
      scope: Scope.project(),
    });
    expect(result.embeddingEnqueued).toBe(false);
    expect(repo.stored.length).toBe(1);
  });

  it("propagates VO factory errors (empty text)", async () => {
    const { useCase } = makeUseCase();
    await expect(
      useCase.record({
        workspaceId: makeWorkspaceId(),
        text: "",
        severity: null,
        tags: makeTags(),
        scope: Scope.project(),
      }),
    ).rejects.toThrow(InvalidInputError);
  });
});
