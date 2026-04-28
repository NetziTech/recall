import { describe, expect, it } from "vitest";
import { RecordDecisionUseCase } from "../../../../src/modules/memory/application/use-cases/record-decision.use-case.ts";
import type { DecisionRepository } from "../../../../src/modules/memory/domain/repositories/decision-repository.ts";
import type {
  EmbeddableKind,
  EmbeddingEnqueuer,
} from "../../../../src/modules/memory/application/ports/out/embedding-enqueuer.port.ts";
import { Decision } from "../../../../src/modules/memory/domain/aggregates/decision.ts";
import { DecisionId } from "../../../../src/modules/memory/domain/value-objects/decision-id.ts";
import type { DecisionStatus } from "../../../../src/modules/memory/domain/value-objects/decision-status.ts";
import { Scope } from "../../../../src/modules/memory/domain/value-objects/scope.ts";
import type { Tags as TagsT } from "../../../../src/shared/domain/value-objects/tags.ts";
import type { WorkspaceId } from "../../../../src/shared/domain/value-objects/workspace-id.ts";
import { Timestamp } from "../../../../src/shared/domain/value-objects/timestamp.ts";
import { FakeClock } from "../../../../src/shared/infrastructure/clock/fake-clock.ts";
import { FakeIdGenerator } from "../../../../src/shared/infrastructure/id-generator/fake-id-generator.ts";
import { DecisionRecorded } from "../../../../src/modules/memory/domain/events/decision-recorded.ts";
import { InvalidInputError } from "../../../../src/shared/domain/errors/invalid-input-error.ts";
import {
  ANCHOR_TIME_MS,
  FIXED_DECISION_UUID,
  makeTags,
  makeWorkspaceId,
} from "../../../helpers/factories.ts";
import {
  RecordingEventPublisher,
  SilentLogger,
} from "../../../helpers/test-doubles.ts";

class InMemoryDecisionRepo implements DecisionRepository {
  public readonly stored: Decision[] = [];
  public failOnSave = false;

  public findById(id: DecisionId): Promise<Decision | null> {
    const found = this.stored.find((d) => d.getId().equals(id));
    return Promise.resolve(found ?? null);
  }

  public save(decision: Decision): Promise<void> {
    if (this.failOnSave) {
      return Promise.reject(new Error("save failed"));
    }
    this.stored.push(decision);
    return Promise.resolve();
  }

  public findByWorkspace(
    workspaceId: WorkspaceId,
    status?: DecisionStatus,
  ): Promise<readonly Decision[]> {
    void workspaceId;
    void status;
    return Promise.resolve(this.stored);
  }

  public findActiveByTags(
    workspaceId: WorkspaceId,
    required: TagsT,
  ): Promise<readonly Decision[]> {
    void workspaceId;
    void required;
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

function makeUseCase() {
  const repo = new InMemoryDecisionRepo();
  const enqueuer = new RecordingEnqueuer();
  const clock = new FakeClock({ initialMs: ANCHOR_TIME_MS });
  const idGen = new FakeIdGenerator({ sequence: [FIXED_DECISION_UUID] });
  const events = new RecordingEventPublisher();
  const logger = new SilentLogger();
  const useCase = new RecordDecisionUseCase(
    repo,
    enqueuer,
    idGen,
    clock,
    events,
    logger,
  );
  return { useCase, repo, enqueuer, events };
}

describe("RecordDecisionUseCase.record", () => {
  it("persists a decision, publishes the event, and enqueues embedding", async () => {
    const { useCase, repo, enqueuer, events } = makeUseCase();
    const result = await useCase.record({
      workspaceId: makeWorkspaceId(),
      sessionId: null,
      title: "Adopt SQLCipher",
      rationale: "Encryption at rest",
      tags: makeTags(["db"]),
      scope: Scope.project(),
    });
    expect(result.decisionId.toString()).toBe(FIXED_DECISION_UUID);
    expect(result.embeddingEnqueued).toBe(true);
    expect(repo.stored.length).toBe(1);
    expect(enqueuer.calls.length).toBe(1);
    expect(events.published()[0]).toBeInstanceOf(DecisionRecorded);
  });

  it("returns embeddingEnqueued=false when enqueuer fails (does NOT roll back)", async () => {
    const { useCase, repo, enqueuer } = makeUseCase();
    enqueuer.failNext = true;
    const result = await useCase.record({
      workspaceId: makeWorkspaceId(),
      sessionId: null,
      title: "Use UTC",
      rationale: "Avoid timezone drift",
      tags: makeTags(),
      scope: Scope.project(),
    });
    expect(result.embeddingEnqueued).toBe(false);
    // The row was still persisted (enqueue is best-effort).
    expect(repo.stored.length).toBe(1);
  });

  it("propagates VO factory errors (invalid title)", async () => {
    const { useCase } = makeUseCase();
    await expect(
      useCase.record({
        workspaceId: makeWorkspaceId(),
        sessionId: null,
        title: "",
        rationale: "Some rationale",
        tags: makeTags(),
        scope: Scope.project(),
      }),
    ).rejects.toThrow(InvalidInputError);
  });
});
