import { describe, expect, it } from "vitest";
import { RecordRelationUseCase } from "../../../../src/modules/memory/application/use-cases/record-relation.use-case.ts";
import { MemoryApplicationError } from "../../../../src/modules/memory/application/errors/memory-application-error.ts";
import type { RelationRepository } from "../../../../src/modules/memory/domain/repositories/relation-repository.ts";
import type { EntityRepository } from "../../../../src/modules/memory/domain/repositories/entity-repository.ts";
import { Relation } from "../../../../src/modules/memory/domain/aggregates/relation.ts";
import { Entity } from "../../../../src/modules/memory/domain/aggregates/entity.ts";
import { EntityId } from "../../../../src/modules/memory/domain/value-objects/entity-id.ts";
import { EntityKind } from "../../../../src/modules/memory/domain/value-objects/entity-kind.ts";
import { EntityName } from "../../../../src/modules/memory/domain/value-objects/entity-name.ts";
import { EntityDescription } from "../../../../src/modules/memory/domain/value-objects/entity-description.ts";
import { EmbeddingStatus } from "../../../../src/modules/memory/domain/value-objects/embedding-status.ts";
import { Scope } from "../../../../src/modules/memory/domain/value-objects/scope.ts";
import { RelationEndpoint } from "../../../../src/modules/memory/domain/value-objects/relation-endpoint.ts";
import { RelationKind } from "../../../../src/modules/memory/domain/value-objects/relation-kind.ts";
import type { RelationId } from "../../../../src/modules/memory/domain/value-objects/relation-id.ts";
import { DecisionId } from "../../../../src/modules/memory/domain/value-objects/decision-id.ts";
import { Confidence } from "../../../../src/shared/domain/value-objects/confidence.ts";
import { FakeClock } from "../../../../src/shared/infrastructure/clock/fake-clock.ts";
import { FakeIdGenerator } from "../../../../src/shared/infrastructure/id-generator/fake-id-generator.ts";
import { RelationCreated } from "../../../../src/modules/memory/domain/events/relation-created.ts";
import {
  ANCHOR_TIME_MS,
  FIXED_DECISION_UUID,
  FIXED_ENTITY_UUID,
  FIXED_RELATION_UUID,
  makeTags,
  makeTimestamp,
  makeWorkspaceId,
} from "../../../helpers/factories.ts";
import { RecordingEventPublisher } from "../../../helpers/test-doubles.ts";

const ENTITY_A = "01952f3c-2222-7000-8000-eeeeeeeeee01";
const ENTITY_B = "01952f3c-2222-7000-8000-eeeeeeeeee02";

class InMemoryRelationRepo implements RelationRepository {
  public readonly stored: Relation[] = [];

  public findById(id: RelationId): Promise<Relation | null> {
    return Promise.resolve(
      this.stored.find((r) => r.getId().equals(id)) ?? null,
    );
  }

  public save(relation: Relation): Promise<void> {
    this.stored.push(relation);
    return Promise.resolve();
  }

  public findFromEndpoint(): Promise<readonly Relation[]> {
    return Promise.resolve([]);
  }

  public findToEndpoint(): Promise<readonly Relation[]> {
    return Promise.resolve([]);
  }

  public findAllByWorkspace(): Promise<readonly Relation[]> {
    return Promise.resolve(this.stored);
  }
}

class InMemoryEntityRepo implements EntityRepository {
  public readonly byId = new Map<string, Entity>();

  public findById(id: EntityId): Promise<Entity | null> {
    return Promise.resolve(this.byId.get(id.toString()) ?? null);
  }

  public save(entity: Entity): Promise<void> {
    this.byId.set(entity.getId().toString(), entity);
    return Promise.resolve();
  }

  public findByWorkspace(): Promise<readonly Entity[]> {
    return Promise.resolve([...this.byId.values()]);
  }

  public findByNameAndKind(): Promise<Entity | null> {
    return Promise.resolve(null);
  }
}

function seedEntity(repo: InMemoryEntityRepo, idStr: string): void {
  const ws = makeWorkspaceId();
  const e = Entity.register({
    id: EntityId.from(idStr),
    workspaceId: ws,
    name: EntityName.from(`E_${idStr.slice(-4)}`),
    kind: EntityKind.classKind(),
    description: EntityDescription.unknown(),
    tags: makeTags(),
    confidence: Confidence.full(),
    scope: Scope.project(),
    embeddingStatus: EmbeddingStatus.pending(),
    occurredAt: makeTimestamp(),
  });
  e.pullEvents();
  repo.byId.set(e.getId().toString(), e);
}

function makeUseCase(): {
  useCase: RecordRelationUseCase;
  relationRepo: InMemoryRelationRepo;
  entityRepo: InMemoryEntityRepo;
  events: RecordingEventPublisher;
} {
  const relationRepo = new InMemoryRelationRepo();
  const entityRepo = new InMemoryEntityRepo();
  seedEntity(entityRepo, ENTITY_A);
  seedEntity(entityRepo, ENTITY_B);
  seedEntity(entityRepo, FIXED_ENTITY_UUID);
  const clock = new FakeClock({ initialMs: ANCHOR_TIME_MS });
  const idGen = new FakeIdGenerator({ sequence: [FIXED_RELATION_UUID] });
  const events = new RecordingEventPublisher();
  const useCase = new RecordRelationUseCase(
    relationRepo,
    entityRepo,
    idGen,
    clock,
    events,
  );
  return { useCase, relationRepo, entityRepo, events };
}

describe("RecordRelationUseCase.record", () => {
  it("creates an entity-to-entity edge when both endpoints exist", async () => {
    const { useCase, relationRepo, events } = makeUseCase();
    const result = await useCase.record({
      workspaceId: makeWorkspaceId(),
      from: RelationEndpoint.entity(EntityId.from(ENTITY_A)),
      to: RelationEndpoint.entity(EntityId.from(ENTITY_B)),
      kind: RelationKind.dependsOn(),
      weightValue: 0.8,
    });
    expect(result.relationId.toString()).toBe(FIXED_RELATION_UUID);
    expect(relationRepo.stored.length).toBe(1);
    expect(events.published()[0]).toBeInstanceOf(RelationCreated);
  });

  it("rejects non-entity endpoint with relationEndpointMissing", async () => {
    const { useCase } = makeUseCase();
    await expect(
      useCase.record({
        workspaceId: makeWorkspaceId(),
        from: RelationEndpoint.decision(DecisionId.from(FIXED_DECISION_UUID)),
        to: RelationEndpoint.entity(EntityId.from(ENTITY_A)),
        kind: RelationKind.references(),
        weightValue: 0.5,
      }),
    ).rejects.toMatchObject({
      code: "memory.relation-endpoint-missing",
    });
  });

  it("rejects when from-entity not found", async () => {
    const { useCase, entityRepo } = makeUseCase();
    entityRepo.byId.delete(ENTITY_A);
    await expect(
      useCase.record({
        workspaceId: makeWorkspaceId(),
        from: RelationEndpoint.entity(EntityId.from(ENTITY_A)),
        to: RelationEndpoint.entity(EntityId.from(ENTITY_B)),
        kind: RelationKind.references(),
        weightValue: 1.0,
      }),
    ).rejects.toBeInstanceOf(MemoryApplicationError);
  });

  it("rejects when to-entity not found", async () => {
    const { useCase, entityRepo } = makeUseCase();
    entityRepo.byId.delete(ENTITY_B);
    await expect(
      useCase.record({
        workspaceId: makeWorkspaceId(),
        from: RelationEndpoint.entity(EntityId.from(ENTITY_A)),
        to: RelationEndpoint.entity(EntityId.from(ENTITY_B)),
        kind: RelationKind.references(),
        weightValue: 1.0,
      }),
    ).rejects.toBeInstanceOf(MemoryApplicationError);
  });
});
