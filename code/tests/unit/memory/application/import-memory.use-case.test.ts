import { describe, expect, it } from "vitest";
import { ImportMemoryUseCase } from "../../../../src/modules/memory/application/use-cases/import-memory.use-case.ts";
import { MemoryApplicationError } from "../../../../src/modules/memory/application/errors/memory-application-error.ts";
import type { MemoryImporter } from "../../../../src/modules/memory/application/ports/out/memory-importer.port.ts";
import type { MemorySnapshot } from "../../../../src/modules/memory/application/ports/out/memory-exporter.port.ts";
import type { DecisionRepository } from "../../../../src/modules/memory/domain/repositories/decision-repository.ts";
import type { LearningRepository } from "../../../../src/modules/memory/domain/repositories/learning-repository.ts";
import type { EntityRepository } from "../../../../src/modules/memory/domain/repositories/entity-repository.ts";
import type { TaskRepository } from "../../../../src/modules/memory/domain/repositories/task-repository.ts";
import type { TurnRepository } from "../../../../src/modules/memory/domain/repositories/turn-repository.ts";
import type { SessionRepository } from "../../../../src/modules/memory/domain/repositories/session-repository.ts";
import type { RelationRepository } from "../../../../src/modules/memory/domain/repositories/relation-repository.ts";
import { Decision } from "../../../../src/modules/memory/domain/aggregates/decision.ts";
import { Learning } from "../../../../src/modules/memory/domain/aggregates/learning.ts";
import { Entity } from "../../../../src/modules/memory/domain/aggregates/entity.ts";
import { DecisionId } from "../../../../src/modules/memory/domain/value-objects/decision-id.ts";
import { LearningId } from "../../../../src/modules/memory/domain/value-objects/learning-id.ts";
import { EntityId } from "../../../../src/modules/memory/domain/value-objects/entity-id.ts";
import { DecisionTitle } from "../../../../src/modules/memory/domain/value-objects/decision-title.ts";
import { Rationale } from "../../../../src/modules/memory/domain/value-objects/rationale.ts";
import { LearningText } from "../../../../src/modules/memory/domain/value-objects/learning-text.ts";
import { LearningSeverity } from "../../../../src/modules/memory/domain/value-objects/learning-severity.ts";
import { EntityName } from "../../../../src/modules/memory/domain/value-objects/entity-name.ts";
import { EntityKind } from "../../../../src/modules/memory/domain/value-objects/entity-kind.ts";
import { EntityDescription } from "../../../../src/modules/memory/domain/value-objects/entity-description.ts";
import { EmbeddingStatus } from "../../../../src/modules/memory/domain/value-objects/embedding-status.ts";
import { Scope } from "../../../../src/modules/memory/domain/value-objects/scope.ts";
import type { DatabaseConnection } from "../../../../src/shared/application/ports/database-connection.port.ts";
import { Confidence } from "../../../../src/shared/domain/value-objects/confidence.ts";
import type { WorkspaceId } from "../../../../src/shared/domain/value-objects/workspace-id.ts";
import { FakeClock } from "../../../../src/shared/infrastructure/clock/fake-clock.ts";
import {
  ANCHOR_TIME_MS,
  FIXED_DECISION_UUID,
  FIXED_ENTITY_UUID,
  FIXED_LEARNING_UUID,
  makeTags,
  makeTimestamp,
  makeWorkspaceId,
} from "../../../helpers/factories.ts";
import { SilentLogger } from "../../../helpers/test-doubles.ts";

const EMPTY_SNAPSHOT: MemorySnapshot = {
  decisions: [],
  learnings: [],
  entities: [],
  tasks: [],
  turns: [],
  sessions: [],
  relations: [],
};

class FakeDb implements DatabaseConnection {
  public transactionRan = 0;
  public prepare(): never {
    throw new Error("not used");
  }
  public exec(): void {}
  public transaction<T>(fn: () => T): T {
    this.transactionRan += 1;
    return fn();
  }
  public close(): void {}
}

class StubImporter implements MemoryImporter {
  public constructor(private readonly snap: MemorySnapshot) {}
  public parse(input: { json: string; workspaceId: WorkspaceId }): MemorySnapshot {
    void input;
    return this.snap;
  }
}

function recordingRepo<T extends { getId(): { toString(): string } }>(): {
  saved: T[];
  byId: Map<string, T>;
  findById(id: { toString(): string }): Promise<T | null>;
  save(agg: T): Promise<void>;
} {
  const saved: T[] = [];
  const byId = new Map<string, T>();
  return {
    saved,
    byId,
    findById(id) {
      return Promise.resolve(byId.get(id.toString()) ?? null);
    },
    save(agg) {
      saved.push(agg);
      byId.set(agg.getId().toString(), agg);
      return Promise.resolve();
    },
  };
}

function makeDecisionRepo(seedId?: string): DecisionRepository & {
  saved: Decision[];
} {
  const r = recordingRepo<Decision>();
  if (seedId !== undefined) {
    const d = Decision.record({
      id: DecisionId.from(seedId),
      workspaceId: makeWorkspaceId(),
      sessionId: null,
      title: DecisionTitle.from("seed"),
      rationale: Rationale.from("seed rationale"),
      tags: makeTags(),
      confidence: Confidence.full(),
      scope: Scope.project(),
      embeddingStatus: EmbeddingStatus.pending(),
      occurredAt: makeTimestamp(),
    });
    d.pullEvents();
    r.byId.set(d.getId().toString(), d);
  }
  return Object.assign(r, {
    findByWorkspace: () => Promise.resolve([] as readonly Decision[]),
    findActiveByTags: () => Promise.resolve([] as readonly Decision[]),
  }) as unknown as DecisionRepository & { saved: Decision[] };
}

function makeLearningRepo(): LearningRepository & { saved: Learning[] } {
  const r = recordingRepo<Learning>();
  return Object.assign(r, {
    findByWorkspace: () => Promise.resolve([] as readonly Learning[]),
    findActiveByMinimumSeverity: () =>
      Promise.resolve([] as readonly Learning[]),
  }) as unknown as LearningRepository & { saved: Learning[] };
}

function makeEntityRepo(): EntityRepository & { saved: Entity[] } {
  const r = recordingRepo<Entity>();
  return Object.assign(r, {
    findByWorkspace: () => Promise.resolve([] as readonly Entity[]),
    findByNameAndKind: () => Promise.resolve(null),
  }) as unknown as EntityRepository & { saved: Entity[] };
}

function makeTaskRepo(): TaskRepository {
  return {
    findById: () => Promise.resolve(null),
    save: () => Promise.resolve(),
    findOpenByWorkspace: () => Promise.resolve([]),
    findByStatus: () => Promise.resolve([]),
    findByPriority: () => Promise.resolve([]),
  };
}

function makeTurnRepo(): TurnRepository {
  return {
    findById: () => Promise.resolve(null),
    save: () => Promise.resolve(),
    findBySession: () => Promise.resolve([]),
    findAllByWorkspace: () => Promise.resolve([]),
  };
}

function makeSessionRepo(): SessionRepository {
  return {
    findById: () => Promise.resolve(null),
    save: () => Promise.resolve(),
    findCurrentByWorkspace: () => Promise.resolve(null),
    findAllByWorkspace: () => Promise.resolve([]),
  };
}

function makeRelationRepo(): RelationRepository {
  return {
    findById: () => Promise.resolve(null),
    save: () => Promise.resolve(),
    findFromEndpoint: () => Promise.resolve([]),
    findToEndpoint: () => Promise.resolve([]),
    findAllByWorkspace: () => Promise.resolve([]),
  };
}

function buildSnapshotWith(args: {
  decisionId?: string;
  learningId?: string;
  entityId?: string;
}): MemorySnapshot {
  const ws = makeWorkspaceId();
  const decisions: Decision[] = [];
  const learnings: Learning[] = [];
  const entities: Entity[] = [];
  if (args.decisionId !== undefined) {
    const d = Decision.record({
      id: DecisionId.from(args.decisionId),
      workspaceId: ws,
      sessionId: null,
      title: DecisionTitle.from("D"),
      rationale: Rationale.from("R"),
      tags: makeTags(),
      confidence: Confidence.full(),
      scope: Scope.project(),
      embeddingStatus: EmbeddingStatus.pending(),
      occurredAt: makeTimestamp(),
    });
    d.pullEvents();
    decisions.push(d);
  }
  if (args.learningId !== undefined) {
    const l = Learning.register({
      id: LearningId.from(args.learningId),
      workspaceId: ws,
      text: LearningText.from("L"),
      severity: LearningSeverity.tip(),
      tags: makeTags(),
      confidence: Confidence.full(),
      scope: Scope.project(),
      embeddingStatus: EmbeddingStatus.pending(),
      occurredAt: makeTimestamp(),
    });
    l.pullEvents();
    learnings.push(l);
  }
  if (args.entityId !== undefined) {
    const e = Entity.register({
      id: EntityId.from(args.entityId),
      workspaceId: ws,
      name: EntityName.from("E"),
      kind: EntityKind.classKind(),
      description: EntityDescription.unknown(),
      tags: makeTags(),
      confidence: Confidence.full(),
      scope: Scope.project(),
      embeddingStatus: EmbeddingStatus.pending(),
      occurredAt: makeTimestamp(),
    });
    e.pullEvents();
    entities.push(e);
  }
  return {
    ...EMPTY_SNAPSHOT,
    decisions,
    learnings,
    entities,
  };
}

function makeUseCase(
  snap: MemorySnapshot,
  decisionRepo?: DecisionRepository & { saved: Decision[] },
): {
  useCase: ImportMemoryUseCase;
  db: FakeDb;
  decisions: DecisionRepository & { saved: Decision[] };
  learnings: LearningRepository & { saved: Learning[] };
  entities: EntityRepository & { saved: Entity[] };
} {
  const db = new FakeDb();
  const decisions = decisionRepo ?? makeDecisionRepo();
  const learnings = makeLearningRepo();
  const entities = makeEntityRepo();
  const useCase = new ImportMemoryUseCase(
    db,
    new StubImporter(snap),
    decisions,
    learnings,
    entities,
    makeTaskRepo(),
    makeTurnRepo(),
    makeSessionRepo(),
    makeRelationRepo(),
    new FakeClock({ initialMs: ANCHOR_TIME_MS }),
    new SilentLogger(),
  );
  return { useCase, db, decisions, learnings, entities };
}

describe("ImportMemoryUseCase.import", () => {
  it("inserts new aggregates and reports counts", async () => {
    const snap = buildSnapshotWith({
      decisionId: FIXED_DECISION_UUID,
      learningId: FIXED_LEARNING_UUID,
      entityId: FIXED_ENTITY_UUID,
    });
    const { useCase, db, decisions, learnings, entities } = makeUseCase(snap);
    const result = await useCase.import({
      workspaceId: makeWorkspaceId(),
      json: "{}",
      conflictStrategy: "skip",
    });
    expect(result.counts.decisions).toBe(1);
    expect(result.counts.learnings).toBe(1);
    expect(result.counts.entities).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.replaced).toBe(0);
    expect(decisions.saved.length).toBe(1);
    expect(learnings.saved.length).toBe(1);
    expect(entities.saved.length).toBe(1);
    expect(db.transactionRan).toBe(1);
  });

  it("skips collisions under 'skip' strategy", async () => {
    const snap = buildSnapshotWith({ decisionId: FIXED_DECISION_UUID });
    const seededRepo = makeDecisionRepo(FIXED_DECISION_UUID);
    const { useCase, decisions } = makeUseCase(snap, seededRepo);
    const result = await useCase.import({
      workspaceId: makeWorkspaceId(),
      json: "{}",
      conflictStrategy: "skip",
    });
    expect(result.skipped).toBe(1);
    expect(result.counts.decisions).toBe(0);
    expect(decisions.saved.length).toBe(0);
  });

  it("replaces collisions under 'replace' strategy", async () => {
    const snap = buildSnapshotWith({ decisionId: FIXED_DECISION_UUID });
    const seededRepo = makeDecisionRepo(FIXED_DECISION_UUID);
    const { useCase, decisions } = makeUseCase(snap, seededRepo);
    const result = await useCase.import({
      workspaceId: makeWorkspaceId(),
      json: "{}",
      conflictStrategy: "replace",
    });
    expect(result.replaced).toBe(1);
    expect(result.counts.decisions).toBe(1);
    expect(decisions.saved.length).toBe(1);
  });

  it("throws importValidationFailed under 'error' strategy on collision", async () => {
    const snap = buildSnapshotWith({ decisionId: FIXED_DECISION_UUID });
    const seededRepo = makeDecisionRepo(FIXED_DECISION_UUID);
    const { useCase } = makeUseCase(snap, seededRepo);
    await expect(
      useCase.import({
        workspaceId: makeWorkspaceId(),
        json: "{}",
        conflictStrategy: "error",
      }),
    ).rejects.toBeInstanceOf(MemoryApplicationError);
  });
});
