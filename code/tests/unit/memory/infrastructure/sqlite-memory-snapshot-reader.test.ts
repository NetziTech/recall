import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteMemorySnapshotReader } from "../../../../src/modules/memory/infrastructure/persistence/sqlite-memory-snapshot-reader.ts";
import { SqliteDecisionRepository } from "../../../../src/modules/memory/infrastructure/persistence/sqlite-decision-repository.ts";
import { SqliteLearningRepository } from "../../../../src/modules/memory/infrastructure/persistence/sqlite-learning-repository.ts";
import { SqliteEntityRepository } from "../../../../src/modules/memory/infrastructure/persistence/sqlite-entity-repository.ts";
import { SqliteTaskRepository } from "../../../../src/modules/memory/infrastructure/persistence/sqlite-task-repository.ts";
import { SqliteTurnRepository } from "../../../../src/modules/memory/infrastructure/persistence/sqlite-turn-repository.ts";
import { SqliteSessionRepository } from "../../../../src/modules/memory/infrastructure/persistence/sqlite-session-repository.ts";
import { SqliteRelationRepository } from "../../../../src/modules/memory/infrastructure/persistence/sqlite-relation-repository.ts";
import { Decision } from "../../../../src/modules/memory/domain/aggregates/decision.ts";
import { Task } from "../../../../src/modules/memory/domain/aggregates/task.ts";
import { Session } from "../../../../src/modules/memory/domain/aggregates/session.ts";
import { DecisionId } from "../../../../src/modules/memory/domain/value-objects/decision-id.ts";
import { TaskId } from "../../../../src/modules/memory/domain/value-objects/task-id.ts";
import { SessionId } from "../../../../src/modules/memory/domain/value-objects/session-id.ts";
import { DecisionTitle } from "../../../../src/modules/memory/domain/value-objects/decision-title.ts";
import { DecisionContent } from "../../../../src/modules/memory/domain/value-objects/decision-content.ts";
import { Rationale } from "../../../../src/modules/memory/domain/value-objects/rationale.ts";
import { TaskTitle } from "../../../../src/modules/memory/domain/value-objects/task-title.ts";
import { TaskPriority } from "../../../../src/modules/memory/domain/value-objects/task-priority.ts";
import { Scope } from "../../../../src/modules/memory/domain/value-objects/scope.ts";
import { EmbeddingStatus } from "../../../../src/modules/memory/domain/value-objects/embedding-status.ts";
import { Confidence } from "../../../../src/shared/domain/value-objects/confidence.ts";
import { WorkspaceId } from "../../../../src/shared/domain/value-objects/workspace-id.ts";
import { newMemoryDatabase } from "../../../_fixtures/memory-database.ts";
import {
  ANCHOR_TIME_MS,
  FIXED_DECISION_UUID,
  FIXED_SESSION_UUID,
  FIXED_TASK_UUID,
  makeTags,
  makeTimestamp,
  makeWorkspaceId,
} from "../../../helpers/factories.ts";

const OTHER_WS = "01952f3c-2222-7000-8000-aaaaaaaaaa99";

interface Ctx {
  db: Awaited<ReturnType<typeof newMemoryDatabase>>;
  reader: SqliteMemorySnapshotReader;
  decisions: SqliteDecisionRepository;
  tasks: SqliteTaskRepository;
  sessions: SqliteSessionRepository;
}
let ctx: Ctx;

beforeEach(async () => {
  const db = await newMemoryDatabase();
  const ws = makeWorkspaceId();
  const decisions = new SqliteDecisionRepository(db, ws);
  const learnings = new SqliteLearningRepository(db, ws);
  const entities = new SqliteEntityRepository(db, ws);
  const tasks = new SqliteTaskRepository(db, ws);
  const turns = new SqliteTurnRepository(db, ws);
  const sessions = new SqliteSessionRepository(db, ws);
  const relations = new SqliteRelationRepository(db, ws);
  const reader = new SqliteMemorySnapshotReader(
    ws,
    decisions,
    learnings,
    entities,
    tasks,
    turns,
    sessions,
    relations,
  );
  ctx = { db, reader, decisions, tasks, sessions };
});
afterEach(() => {
  ctx.db.close();
});

describe("SqliteMemorySnapshotReader.read", () => {
  it("returns empty snapshot on empty workspace", async () => {
    const snap = await ctx.reader.read({ workspaceId: makeWorkspaceId() });
    expect(snap.decisions.length).toBe(0);
    expect(snap.learnings.length).toBe(0);
    expect(snap.entities.length).toBe(0);
    expect(snap.tasks.length).toBe(0);
    expect(snap.turns.length).toBe(0);
    expect(snap.sessions.length).toBe(0);
    expect(snap.relations.length).toBe(0);
  });

  it("collects tasks from all status buckets", async () => {
    const t1 = Task.create({
      id: TaskId.from(FIXED_TASK_UUID),
      workspaceId: makeWorkspaceId(),
      sessionId: null,
      title: TaskTitle.from("T"),
      description: null,
      priority: TaskPriority.medium(),
      tags: makeTags(),
      dueAt: null,
      occurredAt: makeTimestamp(),
    });
    t1.pullEvents();
    await ctx.tasks.save(t1);
    t1.start({ occurredAt: makeTimestamp(ANCHOR_TIME_MS + 1) });
    t1.complete({ occurredAt: makeTimestamp(ANCHOR_TIME_MS + 2) });
    await ctx.tasks.save(t1);

    const snap = await ctx.reader.read({ workspaceId: makeWorkspaceId() });
    expect(snap.tasks.length).toBe(1);
    expect(snap.tasks[0]?.getStatus().isDone()).toBe(true);
  });

  it("returns decisions and sessions when populated", async () => {
    const d = Decision.record({
      id: DecisionId.from(FIXED_DECISION_UUID),
      workspaceId: makeWorkspaceId(),
      sessionId: null,
      title: DecisionTitle.from("D"),
      rationale: Rationale.from("R"),
      content: DecisionContent.from("body"),
      tags: makeTags(),
      confidence: Confidence.full(),
      scope: Scope.project(),
      embeddingStatus: EmbeddingStatus.pending(),
      occurredAt: makeTimestamp(),
    });
    d.pullEvents();
    await ctx.decisions.save(d);

    const s = Session.start({
      id: SessionId.from(FIXED_SESSION_UUID),
      workspaceId: makeWorkspaceId(),
      startedAt: makeTimestamp(),
      intent: null,
      resumedFrom: null,
    });
    s.pullEvents();
    await ctx.sessions.save(s);

    const snap = await ctx.reader.read({ workspaceId: makeWorkspaceId() });
    expect(snap.decisions.length).toBe(1);
    expect(snap.sessions.length).toBe(1);
  });

  it("rejects mismatched workspace id", async () => {
    await expect(
      ctx.reader.read({ workspaceId: WorkspaceId.from(OTHER_WS) }),
    ).rejects.toMatchObject({
      code: "memory.persistence.query-failed",
    });
  });
});
