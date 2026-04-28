import { describe, expect, it } from "vitest";
import { RecordEntityUseCase } from "../../../../src/modules/memory/application/use-cases/record-entity.use-case.ts";
import type { EntityRepository } from "../../../../src/modules/memory/domain/repositories/entity-repository.ts";
import type {
  EmbeddableKind,
  EmbeddingEnqueuer,
} from "../../../../src/modules/memory/application/ports/out/embedding-enqueuer.port.ts";
import { Entity } from "../../../../src/modules/memory/domain/aggregates/entity.ts";
import { EntityId } from "../../../../src/modules/memory/domain/value-objects/entity-id.ts";
import { EntityKind } from "../../../../src/modules/memory/domain/value-objects/entity-kind.ts";
import { EntityName } from "../../../../src/modules/memory/domain/value-objects/entity-name.ts";
import { EntityDescription } from "../../../../src/modules/memory/domain/value-objects/entity-description.ts";
import { EmbeddingStatus } from "../../../../src/modules/memory/domain/value-objects/embedding-status.ts";
import { Scope } from "../../../../src/modules/memory/domain/value-objects/scope.ts";
import { Confidence } from "../../../../src/shared/domain/value-objects/confidence.ts";
import type { Timestamp } from "../../../../src/shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../src/shared/domain/value-objects/workspace-id.ts";
import { FakeClock } from "../../../../src/shared/infrastructure/clock/fake-clock.ts";
import { FakeIdGenerator } from "../../../../src/shared/infrastructure/id-generator/fake-id-generator.ts";
import { EntityRegistered } from "../../../../src/modules/memory/domain/events/entity-registered.ts";
import { InvalidInputError } from "../../../../src/shared/domain/errors/invalid-input-error.ts";
import {
  ANCHOR_TIME_MS,
  FIXED_ENTITY_UUID,
  makeTags,
  makeTimestamp,
  makeWorkspaceId,
} from "../../../helpers/factories.ts";
import {
  RecordingEventPublisher,
  SilentLogger,
} from "../../../helpers/test-doubles.ts";

class InMemoryEntityRepo implements EntityRepository {
  public readonly stored: Entity[] = [];

  public findById(id: EntityId): Promise<Entity | null> {
    return Promise.resolve(
      this.stored.find((e) => e.getId().equals(id)) ?? null,
    );
  }

  public save(entity: Entity): Promise<void> {
    this.stored.push(entity);
    return Promise.resolve();
  }

  public findByWorkspace(
    _ws: WorkspaceId,
    kind?: EntityKind,
  ): Promise<readonly Entity[]> {
    void _ws;
    if (kind === undefined) return Promise.resolve(this.stored);
    return Promise.resolve(
      this.stored.filter((e) => e.getKind().equals(kind)),
    );
  }

  public findByNameAndKind(
    _ws: WorkspaceId,
    name: EntityName,
    kind: EntityKind,
  ): Promise<Entity | null> {
    void _ws;
    const found = this.stored.find(
      (e) =>
        e.getName().toString() === name.toString() &&
        e.getKind().equals(kind),
    );
    return Promise.resolve(found ?? null);
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
  useCase: RecordEntityUseCase;
  repo: InMemoryEntityRepo;
  enqueuer: RecordingEnqueuer;
  events: RecordingEventPublisher;
} {
  const repo = new InMemoryEntityRepo();
  const enqueuer = new RecordingEnqueuer();
  const clock = new FakeClock({ initialMs: ANCHOR_TIME_MS });
  const idGen = new FakeIdGenerator({ sequence: [FIXED_ENTITY_UUID] });
  const events = new RecordingEventPublisher();
  const useCase = new RecordEntityUseCase(
    repo,
    enqueuer,
    idGen,
    clock,
    events,
    new SilentLogger(),
  );
  return { useCase, repo, enqueuer, events };
}

describe("RecordEntityUseCase.record", () => {
  it("registers a new entity and enqueues embedding", async () => {
    const { useCase, repo, enqueuer, events } = makeUseCase();
    const result = await useCase.record({
      workspaceId: makeWorkspaceId(),
      name: "WorkspaceFileSystem",
      kind: EntityKind.serviceKind(),
      description: "FS port",
      tags: makeTags(),
      scope: Scope.project(),
    });
    expect(result.alreadyExisted).toBe(false);
    expect(result.embeddingEnqueued).toBe(true);
    expect(result.entityId.toString()).toBe(FIXED_ENTITY_UUID);
    expect(repo.stored.length).toBe(1);
    expect(enqueuer.calls.length).toBe(1);
    expect(enqueuer.calls[0]?.targetKind).toBe("entity");
    expect(events.published()[0]).toBeInstanceOf(EntityRegistered);
  });

  it("returns alreadyExisted=true when (name, kind) collides; no event, no enqueue", async () => {
    const { useCase, repo, enqueuer, events } = makeUseCase();
    const ws = makeWorkspaceId();
    repo.stored.push(
      Entity.register({
        id: EntityId.from(FIXED_ENTITY_UUID),
        workspaceId: ws,
        name: EntityName.from("X"),
        kind: EntityKind.serviceKind(),
        description: EntityDescription.unknown(),
        tags: makeTags(),
        confidence: Confidence.full(),
        scope: Scope.project(),
        embeddingStatus: EmbeddingStatus.pending(),
        occurredAt: makeTimestamp(),
      }),
    );
    repo.stored[0]?.pullEvents();
    const result = await useCase.record({
      workspaceId: ws,
      name: "X",
      kind: EntityKind.serviceKind(),
      description: null,
      tags: makeTags(),
      scope: Scope.project(),
    });
    expect(result.alreadyExisted).toBe(true);
    expect(result.embeddingEnqueued).toBe(false);
    expect(repo.stored.length).toBe(1);
    expect(enqueuer.calls.length).toBe(0);
    expect(events.published().length).toBe(0);
  });

  it("treats null and whitespace-only descriptions as unknown", async () => {
    const { useCase, repo } = makeUseCase();
    await useCase.record({
      workspaceId: makeWorkspaceId(),
      name: "Y",
      kind: EntityKind.classKind(),
      description: "   ",
      tags: makeTags(),
      scope: Scope.project(),
    });
    expect(repo.stored[0]?.getDescription().toStringOrNull()).toBe(null);
  });

  it("returns embeddingEnqueued=false on enqueue failure (entry persists)", async () => {
    const { useCase, repo, enqueuer } = makeUseCase();
    enqueuer.failNext = true;
    const result = await useCase.record({
      workspaceId: makeWorkspaceId(),
      name: "Z",
      kind: EntityKind.classKind(),
      description: null,
      tags: makeTags(),
      scope: Scope.project(),
    });
    expect(result.embeddingEnqueued).toBe(false);
    expect(repo.stored.length).toBe(1);
  });

  it("propagates VO factory error on bad name", async () => {
    const { useCase } = makeUseCase();
    await expect(
      useCase.record({
        workspaceId: makeWorkspaceId(),
        name: "",
        kind: EntityKind.classKind(),
        description: null,
        tags: makeTags(),
        scope: Scope.project(),
      }),
    ).rejects.toThrow(InvalidInputError);
  });
});
