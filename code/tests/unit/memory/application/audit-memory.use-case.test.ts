import { describe, expect, it } from "vitest";
import { AuditMemoryUseCase } from "../../../../src/modules/memory/application/use-cases/audit-memory.use-case.ts";
import type { DecisionRepository } from "../../../../src/modules/memory/domain/repositories/decision-repository.ts";
import type { LearningRepository } from "../../../../src/modules/memory/domain/repositories/learning-repository.ts";
import type { EntityRepository } from "../../../../src/modules/memory/domain/repositories/entity-repository.ts";
import type { TaskRepository } from "../../../../src/modules/memory/domain/repositories/task-repository.ts";
import type { RelationRepository } from "../../../../src/modules/memory/domain/repositories/relation-repository.ts";
import { Decision } from "../../../../src/modules/memory/domain/aggregates/decision.ts";
import { Learning } from "../../../../src/modules/memory/domain/aggregates/learning.ts";
import { Entity } from "../../../../src/modules/memory/domain/aggregates/entity.ts";
import { Relation } from "../../../../src/modules/memory/domain/aggregates/relation.ts";
import { DecisionId } from "../../../../src/modules/memory/domain/value-objects/decision-id.ts";
import { DecisionTitle } from "../../../../src/modules/memory/domain/value-objects/decision-title.ts";
import { Rationale } from "../../../../src/modules/memory/domain/value-objects/rationale.ts";
import { Scope } from "../../../../src/modules/memory/domain/value-objects/scope.ts";
import { LearningId } from "../../../../src/modules/memory/domain/value-objects/learning-id.ts";
import { LearningSeverity } from "../../../../src/modules/memory/domain/value-objects/learning-severity.ts";
import { LearningText } from "../../../../src/modules/memory/domain/value-objects/learning-text.ts";
import { EntityId } from "../../../../src/modules/memory/domain/value-objects/entity-id.ts";
import { EntityKind } from "../../../../src/modules/memory/domain/value-objects/entity-kind.ts";
import { EntityName } from "../../../../src/modules/memory/domain/value-objects/entity-name.ts";
import { EntityDescription } from "../../../../src/modules/memory/domain/value-objects/entity-description.ts";
import { EmbeddingStatus } from "../../../../src/modules/memory/domain/value-objects/embedding-status.ts";
import { RelationEndpoint } from "../../../../src/modules/memory/domain/value-objects/relation-endpoint.ts";
import { RelationKind } from "../../../../src/modules/memory/domain/value-objects/relation-kind.ts";
import { RelationId } from "../../../../src/modules/memory/domain/value-objects/relation-id.ts";
import { Confidence } from "../../../../src/shared/domain/value-objects/confidence.ts";
import { FakeClock } from "../../../../src/shared/infrastructure/clock/fake-clock.ts";
import {
  ANCHOR_TIME_MS,
  FIXED_DECISION_UUID,
  FIXED_LEARNING_UUID,
  FIXED_RELATION_UUID,
  makeTags,
  makeTimestamp,
  makeWorkspaceId,
} from "../../../helpers/factories.ts";
import { SilentLogger } from "../../../helpers/test-doubles.ts";

class StubDecisionRepo implements DecisionRepository {
  public constructor(public readonly all: readonly Decision[] = []) {}
  public findById(): Promise<Decision | null> {
    return Promise.resolve(null);
  }
  public save(): Promise<void> {
    return Promise.resolve();
  }
  public findByWorkspace(): Promise<readonly Decision[]> {
    return Promise.resolve(this.all);
  }
  public findActiveByTags(): Promise<readonly Decision[]> {
    return Promise.resolve(this.all);
  }
}

class StubLearningRepo implements LearningRepository {
  public constructor(public readonly all: readonly Learning[] = []) {}
  public findById(): Promise<Learning | null> {
    return Promise.resolve(null);
  }
  public save(): Promise<void> {
    return Promise.resolve();
  }
  public findByWorkspace(): Promise<readonly Learning[]> {
    return Promise.resolve(this.all);
  }
  public findActiveByMinimumSeverity(): Promise<readonly Learning[]> {
    return Promise.resolve(this.all);
  }
}

class StubEntityRepo implements EntityRepository {
  public constructor(public readonly all: readonly Entity[] = []) {}
  public findById(): Promise<Entity | null> {
    return Promise.resolve(null);
  }
  public save(): Promise<void> {
    return Promise.resolve();
  }
  public findByWorkspace(): Promise<readonly Entity[]> {
    return Promise.resolve(this.all);
  }
  public findByNameAndKind(): Promise<Entity | null> {
    return Promise.resolve(null);
  }
}

class StubTaskRepo implements TaskRepository {
  public findById(): Promise<null> {
    return Promise.resolve(null);
  }
  public save(): Promise<void> {
    return Promise.resolve();
  }
  public findOpenByWorkspace(): Promise<readonly never[]> {
    return Promise.resolve([]);
  }
  public findByStatus(): Promise<readonly never[]> {
    return Promise.resolve([]);
  }
  public findByPriority(): Promise<readonly never[]> {
    return Promise.resolve([]);
  }
}

class StubRelationRepo implements RelationRepository {
  public constructor(public readonly all: readonly Relation[] = []) {}
  public findById(): Promise<Relation | null> {
    return Promise.resolve(null);
  }
  public save(): Promise<void> {
    return Promise.resolve();
  }
  public findFromEndpoint(): Promise<readonly Relation[]> {
    return Promise.resolve([]);
  }
  public findToEndpoint(): Promise<readonly Relation[]> {
    return Promise.resolve([]);
  }
  public findAllByWorkspace(): Promise<readonly Relation[]> {
    return Promise.resolve(this.all);
  }
}

const ENTITY_OK = "01952f3c-2222-7000-8000-eeeeeeeeee01";
const ENTITY_MISSING = "01952f3c-2222-7000-8000-eeeeeeeeee99";
const DECISION_OTHER = "01952f3c-2222-7000-8000-dddddddddd99";
const LEARNING_OTHER = "01952f3c-2222-7000-8000-cccccccccc99";

function makeDecision(args: {
  id: string;
  superseded?: string | null;
}): Decision {
  const ws = makeWorkspaceId();
  const d = Decision.record({
    id: DecisionId.from(args.id),
    workspaceId: ws,
    sessionId: null,
    title: DecisionTitle.from(`T-${args.id.slice(-4)}`),
    rationale: Rationale.from("R"),
    tags: makeTags(),
    confidence: Confidence.full(),
    scope: Scope.project(),
    embeddingStatus: EmbeddingStatus.pending(),
    occurredAt: makeTimestamp(),
  });
  if (args.superseded !== undefined && args.superseded !== null) {
    d.supersede({
      successorId: DecisionId.from(args.superseded),
      occurredAt: makeTimestamp(ANCHOR_TIME_MS + 1),
    });
  }
  d.pullEvents();
  return d;
}

function makeLearning(args: {
  id: string;
  consolidatedInto?: string | null;
}): Learning {
  const ws = makeWorkspaceId();
  const l = Learning.register({
    id: LearningId.from(args.id),
    workspaceId: ws,
    text: LearningText.from(`L-${args.id.slice(-4)}`),
    severity: LearningSeverity.tip(),
    tags: makeTags(),
    confidence: Confidence.full(),
    scope: Scope.project(),
    embeddingStatus: EmbeddingStatus.pending(),
    occurredAt: makeTimestamp(),
  });
  if (args.consolidatedInto !== undefined && args.consolidatedInto !== null) {
    l.consolidateInto({
      targetId: LearningId.from(args.consolidatedInto),
      occurredAt: makeTimestamp(ANCHOR_TIME_MS + 1),
    });
  }
  l.pullEvents();
  return l;
}

function makeEntity(id: string): Entity {
  const e = Entity.register({
    id: EntityId.from(id),
    workspaceId: makeWorkspaceId(),
    name: EntityName.from(`E-${id.slice(-4)}`),
    kind: EntityKind.classKind(),
    description: EntityDescription.unknown(),
    tags: makeTags(),
    confidence: Confidence.full(),
    scope: Scope.project(),
    embeddingStatus: EmbeddingStatus.pending(),
    occurredAt: makeTimestamp(),
  });
  e.pullEvents();
  return e;
}

function makeRelation(fromId: string, toId: string): Relation {
  const r = Relation.create({
    id: RelationId.from(FIXED_RELATION_UUID),
    workspaceId: makeWorkspaceId(),
    from: RelationEndpoint.entity(EntityId.from(fromId)),
    to: RelationEndpoint.entity(EntityId.from(toId)),
    kind: RelationKind.references(),
    weight: Confidence.full(),
    occurredAt: makeTimestamp(),
  });
  r.pullEvents();
  return r;
}

describe("AuditMemoryUseCase.audit", () => {
  it("returns clean result when no issues", async () => {
    const useCase = new AuditMemoryUseCase(
      new StubDecisionRepo([]),
      new StubLearningRepo([]),
      new StubEntityRepo([]),
      new StubTaskRepo() as unknown as TaskRepository,
      new StubRelationRepo([]),
      new FakeClock({ initialMs: ANCHOR_TIME_MS }),
      new SilentLogger(),
    );
    const result = await useCase.audit({ workspaceId: makeWorkspaceId() });
    expect(result.issues.length).toBe(0);
    expect(result.counts.decisions).toBe(0);
    expect(result.counts.relations).toBe(0);
    expect(result.checkedAtMs).toBe(ANCHOR_TIME_MS);
  });

  it("flags orphan decision supersession", async () => {
    const decisions = [
      makeDecision({ id: FIXED_DECISION_UUID, superseded: DECISION_OTHER }),
    ];
    const useCase = new AuditMemoryUseCase(
      new StubDecisionRepo(decisions),
      new StubLearningRepo([]),
      new StubEntityRepo([]),
      new StubTaskRepo() as unknown as TaskRepository,
      new StubRelationRepo([]),
      new FakeClock({ initialMs: ANCHOR_TIME_MS }),
      new SilentLogger(),
    );
    const result = await useCase.audit({ workspaceId: makeWorkspaceId() });
    expect(result.issues.length).toBe(1);
    expect(result.issues[0]?.code).toBe("decision.orphan-supersession");
    expect(result.issues[0]?.severity).toBe("error");
  });

  it("flags orphan learning consolidation", async () => {
    const learnings = [
      makeLearning({
        id: FIXED_LEARNING_UUID,
        consolidatedInto: LEARNING_OTHER,
      }),
    ];
    const useCase = new AuditMemoryUseCase(
      new StubDecisionRepo([]),
      new StubLearningRepo(learnings),
      new StubEntityRepo([]),
      new StubTaskRepo() as unknown as TaskRepository,
      new StubRelationRepo([]),
      new FakeClock({ initialMs: ANCHOR_TIME_MS }),
      new SilentLogger(),
    );
    const result = await useCase.audit({ workspaceId: makeWorkspaceId() });
    expect(result.issues.some((i) => i.code === "learning.orphan-consolidation")).toBe(
      true,
    );
  });

  it("flags relation with missing entity endpoint", async () => {
    const entities = [makeEntity(ENTITY_OK)];
    const relations = [makeRelation(ENTITY_OK, ENTITY_MISSING)];
    const useCase = new AuditMemoryUseCase(
      new StubDecisionRepo([]),
      new StubLearningRepo([]),
      new StubEntityRepo(entities),
      new StubTaskRepo() as unknown as TaskRepository,
      new StubRelationRepo(relations),
      new FakeClock({ initialMs: ANCHOR_TIME_MS }),
      new SilentLogger(),
    );
    const result = await useCase.audit({ workspaceId: makeWorkspaceId() });
    expect(result.issues.some((i) => i.code === "relation.dangling-endpoint")).toBe(
      true,
    );
    expect(
      result.issues.find((i) => i.code === "relation.dangling-endpoint")?.message,
    ).toContain(ENTITY_MISSING);
  });

  it("does not flag relation when both endpoints exist", async () => {
    const ENTITY_2 = "01952f3c-2222-7000-8000-eeeeeeeeee02";
    const useCase = new AuditMemoryUseCase(
      new StubDecisionRepo([]),
      new StubLearningRepo([]),
      new StubEntityRepo([makeEntity(ENTITY_OK), makeEntity(ENTITY_2)]),
      new StubTaskRepo() as unknown as TaskRepository,
      new StubRelationRepo([makeRelation(ENTITY_OK, ENTITY_2)]),
      new FakeClock({ initialMs: ANCHOR_TIME_MS }),
      new SilentLogger(),
    );
    const result = await useCase.audit({ workspaceId: makeWorkspaceId() });
    expect(
      result.issues.filter((i) => i.code === "relation.dangling-endpoint").length,
    ).toBe(0);
  });

  it("returns counts derived from the repositories", async () => {
    const decisions = [makeDecision({ id: FIXED_DECISION_UUID })];
    const learnings = [makeLearning({ id: FIXED_LEARNING_UUID })];
    const entities = [makeEntity(ENTITY_OK)];
    const useCase = new AuditMemoryUseCase(
      new StubDecisionRepo(decisions),
      new StubLearningRepo(learnings),
      new StubEntityRepo(entities),
      new (class extends StubTaskRepo {
        public override findOpenByWorkspace(): Promise<readonly never[]> {
          return Promise.resolve([null as never]);
        }
      })() as unknown as TaskRepository,
      new StubRelationRepo([]),
      new FakeClock({ initialMs: ANCHOR_TIME_MS }),
      new SilentLogger(),
    );
    const result = await useCase.audit({ workspaceId: makeWorkspaceId() });
    expect(result.counts.decisions).toBe(1);
    expect(result.counts.learnings).toBe(1);
    expect(result.counts.entities).toBe(1);
    expect(result.counts.tasks).toBe(1);
  });
});

