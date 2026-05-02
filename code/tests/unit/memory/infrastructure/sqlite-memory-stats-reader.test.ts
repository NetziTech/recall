import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteMemoryStatsReader } from "../../../../src/modules/memory/infrastructure/persistence/sqlite-memory-stats-reader.ts";
import { SqliteDecisionRepository } from "../../../../src/modules/memory/infrastructure/persistence/sqlite-decision-repository.ts";
import { SqliteLearningRepository } from "../../../../src/modules/memory/infrastructure/persistence/sqlite-learning-repository.ts";
import { SqliteEntityRepository } from "../../../../src/modules/memory/infrastructure/persistence/sqlite-entity-repository.ts";
import { SqliteSessionRepository } from "../../../../src/modules/memory/infrastructure/persistence/sqlite-session-repository.ts";
import { Decision } from "../../../../src/modules/memory/domain/aggregates/decision.ts";
import { Learning } from "../../../../src/modules/memory/domain/aggregates/learning.ts";
import { Entity } from "../../../../src/modules/memory/domain/aggregates/entity.ts";
import { Session } from "../../../../src/modules/memory/domain/aggregates/session.ts";
import { DecisionId } from "../../../../src/modules/memory/domain/value-objects/decision-id.ts";
import { LearningId } from "../../../../src/modules/memory/domain/value-objects/learning-id.ts";
import { EntityId } from "../../../../src/modules/memory/domain/value-objects/entity-id.ts";
import { SessionId } from "../../../../src/modules/memory/domain/value-objects/session-id.ts";
import { DecisionTitle } from "../../../../src/modules/memory/domain/value-objects/decision-title.ts";
import { DecisionContent } from "../../../../src/modules/memory/domain/value-objects/decision-content.ts";
import { Rationale } from "../../../../src/modules/memory/domain/value-objects/rationale.ts";
import { LearningText } from "../../../../src/modules/memory/domain/value-objects/learning-text.ts";
import { LearningSeverity } from "../../../../src/modules/memory/domain/value-objects/learning-severity.ts";
import { EntityName } from "../../../../src/modules/memory/domain/value-objects/entity-name.ts";
import { EntityKind } from "../../../../src/modules/memory/domain/value-objects/entity-kind.ts";
import { EntityDescription } from "../../../../src/modules/memory/domain/value-objects/entity-description.ts";
import { Scope } from "../../../../src/modules/memory/domain/value-objects/scope.ts";
import { EmbeddingStatus } from "../../../../src/modules/memory/domain/value-objects/embedding-status.ts";
import { Confidence } from "../../../../src/shared/domain/value-objects/confidence.ts";
import { WorkspaceId } from "../../../../src/shared/domain/value-objects/workspace-id.ts";
import { newMemoryDatabase } from "../../../_fixtures/memory-database.ts";
import {
  ANCHOR_TIME_MS,
  FIXED_DECISION_UUID,
  FIXED_ENTITY_UUID,
  FIXED_LEARNING_UUID,
  FIXED_SESSION_UUID,
  makeTags,
  makeTimestamp,
  makeWorkspaceId,
} from "../../../helpers/factories.ts";

const OTHER_WS = "01952f3c-2222-7000-8000-aaaaaaaaaa99";
const SECOND_DECISION = "01952f3c-2222-7000-8000-bbbbbbbbbb02";

interface Ctx {
  db: Awaited<ReturnType<typeof newMemoryDatabase>>;
  reader: SqliteMemoryStatsReader;
}
let ctx: Ctx;

beforeEach(async () => {
  const db = await newMemoryDatabase();
  ctx = { db, reader: new SqliteMemoryStatsReader(db, makeWorkspaceId()) };
});
afterEach(() => {
  ctx.db.close();
});

describe("SqliteMemoryStatsReader.read", () => {
  it("returns zero counts and null bounds on empty workspace", async () => {
    const snap = await ctx.reader.read({ workspaceId: makeWorkspaceId() });
    expect(snap.counts.decisions).toBe(0);
    expect(snap.counts.activeDecisions).toBe(0);
    expect(snap.counts.learnings).toBe(0);
    expect(snap.counts.activeLearnings).toBe(0);
    expect(snap.counts.entities).toBe(0);
    expect(snap.counts.tasks).toBe(0);
    expect(snap.counts.openTasks).toBe(0);
    expect(snap.counts.turns).toBe(0);
    expect(snap.counts.sessions).toBe(0);
    expect(snap.counts.activeSessions).toBe(0);
    expect(snap.counts.relations).toBe(0);
    expect(snap.oldestEntryMs).toBe(null);
    expect(snap.newestEntryMs).toBe(null);
  });

  it("counts decisions, learnings, entities and reports time bounds", async () => {
    const decRepo = new SqliteDecisionRepository(ctx.db, makeWorkspaceId());
    const learnRepo = new SqliteLearningRepository(ctx.db, makeWorkspaceId());
    const entRepo = new SqliteEntityRepository(ctx.db, makeWorkspaceId());

    const d = Decision.record({
      id: DecisionId.from(FIXED_DECISION_UUID),
      workspaceId: makeWorkspaceId(),
      sessionId: null,
      title: DecisionTitle.from("d1"),
      rationale: Rationale.from("r"),
      content: DecisionContent.from("body"),
      tags: makeTags(),
      confidence: Confidence.full(),
      scope: Scope.project(),
      embeddingStatus: EmbeddingStatus.pending(),
      occurredAt: makeTimestamp(ANCHOR_TIME_MS),
    });
    d.pullEvents();
    const d2 = Decision.record({
      id: DecisionId.from(SECOND_DECISION),
      workspaceId: makeWorkspaceId(),
      sessionId: null,
      title: DecisionTitle.from("d2"),
      rationale: Rationale.from("r"),
      content: DecisionContent.from("body"),
      tags: makeTags(),
      confidence: Confidence.full(),
      scope: Scope.project(),
      embeddingStatus: EmbeddingStatus.pending(),
      occurredAt: makeTimestamp(ANCHOR_TIME_MS + 5000),
    });
    d2.pullEvents();
    d2.supersede({
      successorId: DecisionId.from(FIXED_DECISION_UUID),
      occurredAt: makeTimestamp(ANCHOR_TIME_MS + 5001),
    });
    d2.pullEvents();
    await decRepo.save(d);
    await decRepo.save(d2);

    const l = Learning.register({
      id: LearningId.from(FIXED_LEARNING_UUID),
      workspaceId: makeWorkspaceId(),
      text: LearningText.from("L"),
      severity: LearningSeverity.tip(),
      tags: makeTags(),
      confidence: Confidence.full(),
      scope: Scope.project(),
      embeddingStatus: EmbeddingStatus.pending(),
      occurredAt: makeTimestamp(ANCHOR_TIME_MS + 10),
    });
    l.pullEvents();
    await learnRepo.save(l);

    const e = Entity.register({
      id: EntityId.from(FIXED_ENTITY_UUID),
      workspaceId: makeWorkspaceId(),
      name: EntityName.from("E"),
      kind: EntityKind.classKind(),
      description: EntityDescription.unknown(),
      tags: makeTags(),
      confidence: Confidence.full(),
      scope: Scope.project(),
      embeddingStatus: EmbeddingStatus.pending(),
      occurredAt: makeTimestamp(ANCHOR_TIME_MS + 20),
    });
    e.pullEvents();
    await entRepo.save(e);

    const sessRepo = new SqliteSessionRepository(ctx.db, makeWorkspaceId());
    const s = Session.start({
      id: SessionId.from(FIXED_SESSION_UUID),
      workspaceId: makeWorkspaceId(),
      startedAt: makeTimestamp(ANCHOR_TIME_MS + 30),
      intent: null,
      resumedFrom: null,
    });
    s.pullEvents();
    await sessRepo.save(s);

    const snap = await ctx.reader.read({ workspaceId: makeWorkspaceId() });
    expect(snap.counts.decisions).toBe(2);
    expect(snap.counts.activeDecisions).toBe(1);
    expect(snap.counts.learnings).toBe(1);
    expect(snap.counts.activeLearnings).toBe(1);
    expect(snap.counts.entities).toBe(1);
    expect(snap.counts.sessions).toBe(1);
    expect(snap.counts.activeSessions).toBe(1);
    expect(snap.oldestEntryMs).toBe(ANCHOR_TIME_MS);
    expect(snap.newestEntryMs).toBe(ANCHOR_TIME_MS + 5000);
  });

  it("rejects mismatched workspace id", async () => {
    await expect(
      ctx.reader.read({ workspaceId: WorkspaceId.from(OTHER_WS) }),
    ).rejects.toMatchObject({
      code: "memory.persistence.query-failed",
    });
  });
});
