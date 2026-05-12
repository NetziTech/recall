import { describe, expect, it } from "vitest";
import { JsonMemoryExporter } from "../../../../src/modules/memory/infrastructure/import-export/json-memory-exporter.ts";
import type { MemorySnapshot } from "../../../../src/modules/memory/application/ports/out/memory-exporter.port.ts";
import { Decision } from "../../../../src/modules/memory/domain/aggregates/decision.ts";
import { Learning } from "../../../../src/modules/memory/domain/aggregates/learning.ts";
import { Entity } from "../../../../src/modules/memory/domain/aggregates/entity.ts";
import { Task } from "../../../../src/modules/memory/domain/aggregates/task.ts";
import { Session } from "../../../../src/modules/memory/domain/aggregates/session.ts";
import { DecisionId } from "../../../../src/modules/memory/domain/value-objects/decision-id.ts";
import { LearningId } from "../../../../src/modules/memory/domain/value-objects/learning-id.ts";
import { EntityId } from "../../../../src/modules/memory/domain/value-objects/entity-id.ts";
import { TaskId } from "../../../../src/modules/memory/domain/value-objects/task-id.ts";
import { SessionId } from "../../../../src/modules/memory/domain/value-objects/session-id.ts";
import { DecisionTitle } from "../../../../src/modules/memory/domain/value-objects/decision-title.ts";
import { DecisionContent } from "../../../../src/modules/memory/domain/value-objects/decision-content.ts";
import { Rationale } from "../../../../src/modules/memory/domain/value-objects/rationale.ts";
import { LearningSeverity } from "../../../../src/modules/memory/domain/value-objects/learning-severity.ts";
import { LearningText } from "../../../../src/modules/memory/domain/value-objects/learning-text.ts";
import { EntityName } from "../../../../src/modules/memory/domain/value-objects/entity-name.ts";
import { EntityKind } from "../../../../src/modules/memory/domain/value-objects/entity-kind.ts";
import { EntityDescription } from "../../../../src/modules/memory/domain/value-objects/entity-description.ts";
import { TaskTitle } from "../../../../src/modules/memory/domain/value-objects/task-title.ts";
import { TaskPriority } from "../../../../src/modules/memory/domain/value-objects/task-priority.ts";
import { Scope } from "../../../../src/modules/memory/domain/value-objects/scope.ts";
import { EmbeddingStatus } from "../../../../src/modules/memory/domain/value-objects/embedding-status.ts";
import { Confidence } from "../../../../src/shared/domain/value-objects/confidence.ts";
import {
  ANCHOR_TIME_MS,
  FIXED_DECISION_UUID,
  FIXED_ENTITY_UUID,
  FIXED_LEARNING_UUID,
  FIXED_SESSION_UUID,
  FIXED_TASK_UUID,
  makeTags,
  makeTimestamp,
  makeWorkspaceId,
} from "../../../helpers/factories.ts";

function emptySnapshot(): MemorySnapshot {
  return {
    decisions: [],
    learnings: [],
    entities: [],
    tasks: [],
    turns: [],
    sessions: [],
    relations: [],
  };
}

describe("JsonMemoryExporter.serialise", () => {
  it("emits an envelope with schemaVersion=1 and empty arrays", () => {
    const out = new JsonMemoryExporter().serialise(emptySnapshot());
    const parsed = JSON.parse(out) as { schemaVersion: number };
    expect(parsed.schemaVersion).toBe(1);
    expect(out).toContain('"decisions": []');
    expect(out).toContain('"learnings": []');
    expect(out).toContain('"entities": []');
    expect(out).toContain('"tasks": []');
    expect(out).toContain('"sessions": []');
    expect(out).toContain('"turns": []');
    expect(out).toContain('"relations": []');
  });

  it("serialises decisions with all relevant fields", () => {
    const ws = makeWorkspaceId();
    const d = Decision.record({
      id: DecisionId.from(FIXED_DECISION_UUID),
      workspaceId: ws,
      sessionId: null,
      title: DecisionTitle.from("T"),
      rationale: Rationale.from("R"),
      content: DecisionContent.from("Long-form content body"),
      tags: makeTags(["a"]),
      confidence: Confidence.full(),
      scope: Scope.module("auth"),
      embeddingStatus: EmbeddingStatus.pending(),
      occurredAt: makeTimestamp(),
    });
    d.pullEvents();
    const snap = { ...emptySnapshot(), decisions: [d] };
    const out = new JsonMemoryExporter().serialise(snap);
    expect(out).toContain('"id": "' + FIXED_DECISION_UUID);
    expect(out).toContain('"title": "T"');
    expect(out).toContain('"kind": "module"');
    expect(out).toContain('"module": "auth"');
  });

  it("serialises learning, entity, task, session aggregates", () => {
    const ws = makeWorkspaceId();
    const l = Learning.register({
      id: LearningId.from(FIXED_LEARNING_UUID),
      workspaceId: ws,
      text: LearningText.from("L"),
      severity: LearningSeverity.warning(),
      tags: makeTags(),
      confidence: Confidence.full(),
      scope: Scope.project(),
      embeddingStatus: EmbeddingStatus.pending(),
      occurredAt: makeTimestamp(),
    });
    l.pullEvents();
    const e = Entity.register({
      id: EntityId.from(FIXED_ENTITY_UUID),
      workspaceId: ws,
      name: EntityName.from("E"),
      kind: EntityKind.classKind(),
      description: EntityDescription.of("desc"),
      tags: makeTags(),
      confidence: Confidence.full(),
      scope: Scope.project(),
      embeddingStatus: EmbeddingStatus.pending(),
      occurredAt: makeTimestamp(),
    });
    e.pullEvents();
    const t = Task.create({
      id: TaskId.from(FIXED_TASK_UUID),
      workspaceId: ws,
      sessionId: null,
      title: TaskTitle.from("T"),
      description: null,
      priority: TaskPriority.high(),
      tags: makeTags(),
      dueAt: makeTimestamp(ANCHOR_TIME_MS + 86_400_000),
      occurredAt: makeTimestamp(),
    });
    t.pullEvents();
    const s = Session.start({
      id: SessionId.from(FIXED_SESSION_UUID),
      workspaceId: ws,
      startedAt: makeTimestamp(),
      intent: null,
      resumedFrom: null,
    });
    s.pullEvents();
    const out = new JsonMemoryExporter().serialise({
      ...emptySnapshot(),
      learnings: [l],
      entities: [e],
      tasks: [t],
      sessions: [s],
    });
    const parsed = JSON.parse(out) as {
      learnings: { severity: string }[];
      entities: { description: string }[];
      tasks: { priority: string; dueAtMs: number }[];
      sessions: { startedAtMs: number }[];
    };
    expect(parsed.learnings[0]?.severity).toBe("warning");
    expect(parsed.entities[0]?.description).toBe("desc");
    expect(parsed.tasks[0]?.priority).toBe("high");
    expect(parsed.tasks[0]?.dueAtMs).toBe(ANCHOR_TIME_MS + 86_400_000);
    expect(parsed.sessions[0]?.startedAtMs).toBe(ANCHOR_TIME_MS);
  });

  it("wraps thrown JSON.stringify errors as exportSerializeFailed", () => {
    // Build an aggregate whose getter throws. The exporter wraps any
    // thrown error.
    const fakeDecision = {
      getId: () => {
        throw new Error("boom");
      },
    };
    const exporter = new JsonMemoryExporter();
    expect(() =>
      exporter.serialise({
        ...emptySnapshot(),
        decisions: [fakeDecision as unknown as Decision],
      }),
    ).toThrow();
  });

  // Coverage focus: every "non-null" arm of the per-kind serialisers
  // (supersededBy, lastUsedMs, consolidatedInto, description,
  // dueAt/completedAt, intent/outcome, endedAt/summary/nextSeed/
  // resumedFrom). The aggregates here are constructed via `rehydrate`
  // factories so we can pin every nullable field directly.
  it("serialises every populated nullable field on the wire", async () => {
    const { Turn } = await import(
      "../../../../src/modules/memory/domain/aggregates/turn.ts"
    );
    const { DecisionStatus } = await import(
      "../../../../src/modules/memory/domain/value-objects/decision-status.ts"
    );
    const { SupersededBy } = await import(
      "../../../../src/modules/memory/domain/value-objects/superseded-by.ts"
    );
    const { LastUsed } = await import(
      "../../../../src/modules/memory/domain/value-objects/last-used.ts"
    );
    const { UseCount } = await import(
      "../../../../src/modules/memory/domain/value-objects/use-count.ts"
    );
    const { TaskStatus } = await import(
      "../../../../src/modules/memory/domain/value-objects/task-status.ts"
    );
    const { TaskDescription } = await import(
      "../../../../src/modules/memory/domain/value-objects/task-description.ts"
    );
    const { TurnId } = await import(
      "../../../../src/modules/memory/domain/value-objects/turn-id.ts"
    );
    const { TurnSummary } = await import(
      "../../../../src/modules/memory/domain/value-objects/turn-summary.ts"
    );
    const { TurnIntent } = await import(
      "../../../../src/modules/memory/domain/value-objects/turn-intent.ts"
    );
    const { TurnOutcome } = await import(
      "../../../../src/modules/memory/domain/value-objects/turn-outcome.ts"
    );
    const { FilesTouched } = await import(
      "../../../../src/modules/memory/domain/value-objects/files-touched.ts"
    );
    const { LinkedDecisionIds } = await import(
      "../../../../src/modules/memory/domain/value-objects/linked-decision-ids.ts"
    );
    const { LinkedLearningIds } = await import(
      "../../../../src/modules/memory/domain/value-objects/linked-learning-ids.ts"
    );
    const { SessionIntent } = await import(
      "../../../../src/modules/memory/domain/value-objects/session-intent.ts"
    );
    const { SessionSummary } = await import(
      "../../../../src/modules/memory/domain/value-objects/session-summary.ts"
    );
    const { SessionNextSeed } = await import(
      "../../../../src/modules/memory/domain/value-objects/session-next-seed.ts"
    );
    const { SessionMetadata } = await import(
      "../../../../src/modules/memory/domain/value-objects/session-metadata.ts"
    );
    const { TurnsCount } = await import(
      "../../../../src/modules/memory/domain/value-objects/turns-count.ts"
    );

    const ws = makeWorkspaceId();
    const TS = makeTimestamp(ANCHOR_TIME_MS);
    const TS_USE = makeTimestamp(ANCHOR_TIME_MS + 10_000);
    const TS_END = makeTimestamp(ANCHOR_TIME_MS + 20_000);

    const successorId = DecisionId.from("01952f3c-2222-7000-8000-d00000000099");
    const decision = Decision.rehydrate({
      id: DecisionId.from(FIXED_DECISION_UUID),
      workspaceId: ws,
      sessionId: null,
      title: DecisionTitle.from("T"),
      rationale: Rationale.from("R"),
      content: DecisionContent.from("Body"),
      tags: makeTags(["a"]),
      status: DecisionStatus.superseded(),
      supersededBy: SupersededBy.of(successorId),
      confidence: Confidence.full(),
      useCount: UseCount.of(2),
      lastUsed: LastUsed.at(TS_USE),
      scope: Scope.project(),
      embeddingStatus: EmbeddingStatus.pending(),
      createdAt: TS,
      updatedAt: TS_USE,
    });

    const consolidationTarget = LearningId.from(
      "01952f3c-2222-7000-8000-cccccccccc09",
    );
    const learning = Learning.rehydrate({
      id: LearningId.from(FIXED_LEARNING_UUID),
      workspaceId: ws,
      text: LearningText.from("L"),
      severity: LearningSeverity.warning(),
      tags: makeTags(),
      confidence: Confidence.full(),
      useCount: UseCount.of(3),
      lastUsed: LastUsed.at(TS_USE),
      scope: Scope.project(),
      embeddingStatus: EmbeddingStatus.pending(),
      consolidatedInto: consolidationTarget,
      createdAt: TS,
      updatedAt: TS_USE,
    });

    const entity = Entity.rehydrate({
      id: EntityId.from(FIXED_ENTITY_UUID),
      workspaceId: ws,
      name: EntityName.from("E"),
      kind: EntityKind.classKind(),
      description: EntityDescription.of("desc"),
      tags: makeTags(),
      confidence: Confidence.full(),
      useCount: UseCount.of(1),
      lastUsed: LastUsed.at(TS_USE),
      scope: Scope.project(),
      embeddingStatus: EmbeddingStatus.pending(),
      createdAt: TS,
      updatedAt: TS_USE,
    });

    const task = Task.rehydrate({
      id: TaskId.from(FIXED_TASK_UUID),
      workspaceId: ws,
      sessionId: null,
      title: TaskTitle.from("T"),
      description: TaskDescription.from("populated"),
      status: TaskStatus.done(),
      priority: TaskPriority.high(),
      tags: makeTags(),
      dueAt: TS_USE,
      createdAt: TS,
      updatedAt: TS_USE,
      completedAt: TS_END,
    });

    const sessionId = SessionId.from(FIXED_SESSION_UUID);
    const previousSessionId = SessionId.from(
      "01952f3c-2222-7000-8000-111111111199",
    );
    const session = Session.rehydrate({
      id: sessionId,
      workspaceId: ws,
      startedAt: TS,
      endedAt: TS_END,
      lastActivityAt: TS_END,
      idleTimeoutMs: 1_800_000,
      intent: SessionIntent.from("intent-x"),
      summary: SessionSummary.from("summary-y"),
      nextSeed: SessionNextSeed.from("seed-z"),
      resumedFrom: previousSessionId,
      turnsCount: TurnsCount.of(1),
      metadata: SessionMetadata.empty(),
    });

    const turn = Turn.rehydrate({
      id: TurnId.from("01952f3c-2222-7000-8000-ffffffffff09"),
      workspaceId: ws,
      sessionId,
      summary: TurnSummary.from("S"),
      intent: TurnIntent.from("intent"),
      outcome: TurnOutcome.from("outcome"),
      filesTouched: FilesTouched.create(["a.ts"]),
      linkedDecisions: LinkedDecisionIds.create([
        DecisionId.from(FIXED_DECISION_UUID),
      ]),
      linkedLearnings: LinkedLearningIds.create([
        LearningId.from(FIXED_LEARNING_UUID),
      ]),
      tags: makeTags(),
      confidence: Confidence.full(),
      useCount: UseCount.of(2),
      lastUsed: LastUsed.at(TS_USE),
      createdAt: TS,
    });

    const out = new JsonMemoryExporter().serialise({
      ...emptySnapshot(),
      decisions: [decision],
      learnings: [learning],
      entities: [entity],
      tasks: [task],
      turns: [turn],
      sessions: [session],
    });
    const parsed = JSON.parse(out) as {
      decisions: { supersededBy: string | null; lastUsedMs: number | null }[];
      learnings: { consolidatedInto: string | null; lastUsedMs: number | null }[];
      entities: { description: string | null; lastUsedMs: number | null }[];
      tasks: { description: string | null; completedAtMs: number | null }[];
      turns: {
        intent: string | null;
        outcome: string | null;
        filesTouched: string[];
        linkedDecisions: string[];
        linkedLearnings: string[];
        lastUsedMs: number | null;
      }[];
      sessions: {
        endedAtMs: number | null;
        intent: string | null;
        summary: string | null;
        nextSeed: string | null;
        resumedFrom: string | null;
      }[];
    };

    // Decision: supersededBy + lastUsedMs both non-null.
    expect(parsed.decisions[0]?.supersededBy).toBe(
      "01952f3c-2222-7000-8000-d00000000099",
    );
    expect(parsed.decisions[0]?.lastUsedMs).toBe(TS_USE.toEpochMs());

    // Learning: consolidatedInto + lastUsedMs both non-null.
    expect(parsed.learnings[0]?.consolidatedInto).toBe(
      "01952f3c-2222-7000-8000-cccccccccc09",
    );
    expect(parsed.learnings[0]?.lastUsedMs).toBe(TS_USE.toEpochMs());

    // Entity: lastUsedMs non-null.
    expect(parsed.entities[0]?.lastUsedMs).toBe(TS_USE.toEpochMs());

    // Task: description + completedAt both non-null.
    expect(parsed.tasks[0]?.description).toBe("populated");
    expect(parsed.tasks[0]?.completedAtMs).toBe(TS_END.toEpochMs());

    // Turn: intent + outcome + non-empty linkedDecisions/linkedLearnings
    //       + lastUsedMs all populated.
    expect(parsed.turns[0]?.intent).toBe("intent");
    expect(parsed.turns[0]?.outcome).toBe("outcome");
    expect(parsed.turns[0]?.filesTouched.length).toBe(1);
    expect(parsed.turns[0]?.linkedDecisions.length).toBe(1);
    expect(parsed.turns[0]?.linkedLearnings.length).toBe(1);
    expect(parsed.turns[0]?.lastUsedMs).toBe(TS_USE.toEpochMs());

    // Session: endedAt + intent + summary + nextSeed + resumedFrom all
    // populated.
    expect(parsed.sessions[0]?.endedAtMs).toBe(TS_END.toEpochMs());
    expect(parsed.sessions[0]?.intent).toBe("intent-x");
    expect(parsed.sessions[0]?.summary).toBe("summary-y");
    expect(parsed.sessions[0]?.nextSeed).toBe("seed-z");
    expect(parsed.sessions[0]?.resumedFrom).toBe(
      "01952f3c-2222-7000-8000-111111111199",
    );
  });

  it("surfaces non-Error throwables with a generic message", () => {
    const fakeDecision = {
      getId: () => {
        throw "not-an-error-object";
      },
    };
    const exporter = new JsonMemoryExporter();
    expect(() =>
      exporter.serialise({
        ...emptySnapshot(),
        decisions: [fakeDecision as unknown as Decision],
      }),
    ).toThrow(/JSON serialisation failed/);
  });
});
