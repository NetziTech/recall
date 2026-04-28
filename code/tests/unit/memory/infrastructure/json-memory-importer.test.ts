import { describe, expect, it } from "vitest";
import { JsonMemoryImporter } from "../../../../src/modules/memory/infrastructure/import-export/json-memory-importer.ts";
import { JsonMemoryExporter } from "../../../../src/modules/memory/infrastructure/import-export/json-memory-exporter.ts";
import type { MemorySnapshot } from "../../../../src/modules/memory/application/ports/out/memory-exporter.port.ts";
import { Decision } from "../../../../src/modules/memory/domain/aggregates/decision.ts";
import { Entity } from "../../../../src/modules/memory/domain/aggregates/entity.ts";
import { DecisionId } from "../../../../src/modules/memory/domain/value-objects/decision-id.ts";
import { EntityId } from "../../../../src/modules/memory/domain/value-objects/entity-id.ts";
import { DecisionTitle } from "../../../../src/modules/memory/domain/value-objects/decision-title.ts";
import { Rationale } from "../../../../src/modules/memory/domain/value-objects/rationale.ts";
import { EntityName } from "../../../../src/modules/memory/domain/value-objects/entity-name.ts";
import { EntityKind } from "../../../../src/modules/memory/domain/value-objects/entity-kind.ts";
import { EntityDescription } from "../../../../src/modules/memory/domain/value-objects/entity-description.ts";
import { Scope } from "../../../../src/modules/memory/domain/value-objects/scope.ts";
import { EmbeddingStatus } from "../../../../src/modules/memory/domain/value-objects/embedding-status.ts";
import { Confidence } from "../../../../src/shared/domain/value-objects/confidence.ts";
import {
  FIXED_DECISION_UUID,
  FIXED_ENTITY_UUID,
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

describe("JsonMemoryImporter.parse", () => {
  it("rejects non-JSON input", () => {
    const importer = new JsonMemoryImporter();
    expect(() =>
      importer.parse({ json: "not json", workspaceId: makeWorkspaceId() }),
    ).toThrow();
  });

  it("rejects unknown schema version", () => {
    const importer = new JsonMemoryImporter();
    const out = JSON.stringify({
      schemaVersion: 99,
      decisions: [],
      learnings: [],
      entities: [],
      tasks: [],
      turns: [],
      sessions: [],
      relations: [],
    });
    expect(() =>
      importer.parse({ json: out, workspaceId: makeWorkspaceId() }),
    ).toThrow(/unsupported schemaVersion/);
  });

  it("parses an empty envelope", () => {
    const importer = new JsonMemoryImporter();
    const out = JSON.stringify({
      schemaVersion: 1,
      decisions: [],
      learnings: [],
      entities: [],
      tasks: [],
      turns: [],
      sessions: [],
      relations: [],
    });
    const snap = importer.parse({
      json: out,
      workspaceId: makeWorkspaceId(),
    });
    expect(snap.decisions.length).toBe(0);
  });

  it("round-trips with the exporter (decisions + entities)", () => {
    const ws = makeWorkspaceId();
    const d = Decision.record({
      id: DecisionId.from(FIXED_DECISION_UUID),
      workspaceId: ws,
      sessionId: null,
      title: DecisionTitle.from("T"),
      rationale: Rationale.from("R"),
      tags: makeTags(["a"]),
      confidence: Confidence.full(),
      scope: Scope.project(),
      embeddingStatus: EmbeddingStatus.pending(),
      occurredAt: makeTimestamp(),
    });
    d.pullEvents();
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
    const exporter = new JsonMemoryExporter();
    const importer = new JsonMemoryImporter();
    const snap = {
      ...emptySnapshot(),
      decisions: [d],
      entities: [e],
    };
    const json = exporter.serialise(snap);
    const back = importer.parse({ json, workspaceId: ws });
    expect(back.decisions.length).toBe(1);
    expect(back.decisions[0]?.getId().toString()).toBe(FIXED_DECISION_UUID);
    expect(back.decisions[0]?.getTitle().toString()).toBe("T");
    expect(back.entities.length).toBe(1);
    expect(back.entities[0]?.getName().toString()).toBe("E");
  });

  it("re-pins workspaceId on every aggregate", () => {
    const sourceWs = makeWorkspaceId("01952f3c-2222-7000-8000-aaaaaaaaaa01");
    const targetWs = makeWorkspaceId("01952f3c-2222-7000-8000-aaaaaaaaaa02");
    const d = Decision.record({
      id: DecisionId.from(FIXED_DECISION_UUID),
      workspaceId: sourceWs,
      sessionId: null,
      title: DecisionTitle.from("T"),
      rationale: Rationale.from("R"),
      tags: makeTags(),
      confidence: Confidence.full(),
      scope: Scope.project(),
      embeddingStatus: EmbeddingStatus.pending(),
      occurredAt: makeTimestamp(),
    });
    d.pullEvents();
    const json = new JsonMemoryExporter().serialise({
      ...emptySnapshot(),
      decisions: [d],
    });
    const back = new JsonMemoryImporter().parse({
      json,
      workspaceId: targetWs,
    });
    expect(back.decisions[0]?.getWorkspaceId().toString()).toBe(targetWs.toString());
  });

  it("rejects malformed envelope (missing decisions array)", () => {
    const importer = new JsonMemoryImporter();
    const out = JSON.stringify({
      schemaVersion: 1,
      learnings: [],
      entities: [],
      tasks: [],
      turns: [],
      sessions: [],
      relations: [],
    });
    expect(() =>
      importer.parse({ json: out, workspaceId: makeWorkspaceId() }),
    ).toThrow();
  });

  it("round-trips every kind via exporter+importer", async () => {
    const ws = makeWorkspaceId();
    const { Learning } = await import(
      "../../../../src/modules/memory/domain/aggregates/learning.ts"
    );
    const { Task } = await import(
      "../../../../src/modules/memory/domain/aggregates/task.ts"
    );
    const { Turn } = await import(
      "../../../../src/modules/memory/domain/aggregates/turn.ts"
    );
    const { Session } = await import(
      "../../../../src/modules/memory/domain/aggregates/session.ts"
    );
    const { Relation } = await import(
      "../../../../src/modules/memory/domain/aggregates/relation.ts"
    );
    const { LearningId } = await import(
      "../../../../src/modules/memory/domain/value-objects/learning-id.ts"
    );
    const { LearningSeverity } = await import(
      "../../../../src/modules/memory/domain/value-objects/learning-severity.ts"
    );
    const { LearningText } = await import(
      "../../../../src/modules/memory/domain/value-objects/learning-text.ts"
    );
    const { TaskId } = await import(
      "../../../../src/modules/memory/domain/value-objects/task-id.ts"
    );
    const { TaskTitle } = await import(
      "../../../../src/modules/memory/domain/value-objects/task-title.ts"
    );
    const { TaskPriority } = await import(
      "../../../../src/modules/memory/domain/value-objects/task-priority.ts"
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
    const { SessionId } = await import(
      "../../../../src/modules/memory/domain/value-objects/session-id.ts"
    );
    const { SessionIntent } = await import(
      "../../../../src/modules/memory/domain/value-objects/session-intent.ts"
    );
    const { OpenQuestionText, OpenQuestion } = await import(
      "../../../../src/modules/memory/domain/value-objects/open-question.ts"
    );
    const { RelationId } = await import(
      "../../../../src/modules/memory/domain/value-objects/relation-id.ts"
    );
    const { RelationKind } = await import(
      "../../../../src/modules/memory/domain/value-objects/relation-kind.ts"
    );
    const { RelationEndpoint } = await import(
      "../../../../src/modules/memory/domain/value-objects/relation-endpoint.ts"
    );

    const learning = Learning.register({
      id: LearningId.from("01952f3c-2222-7000-8000-cccccccccc01"),
      workspaceId: ws,
      text: LearningText.from("L"),
      severity: LearningSeverity.warning(),
      tags: makeTags(["t"]),
      confidence: Confidence.full(),
      scope: Scope.project(),
      embeddingStatus: EmbeddingStatus.pending(),
      occurredAt: makeTimestamp(),
    });
    learning.pullEvents();
    const task = Task.create({
      id: TaskId.from("01952f3c-2222-7000-8000-aaaaaaaaaa01"),
      workspaceId: ws,
      sessionId: null,
      title: TaskTitle.from("T"),
      description: null,
      priority: TaskPriority.high(),
      tags: makeTags(),
      dueAt: makeTimestamp(1700000086400000),
      occurredAt: makeTimestamp(),
    });
    task.pullEvents();
    const session = Session.start({
      id: SessionId.from("01952f3c-2222-7000-8000-111111111101"),
      workspaceId: ws,
      startedAt: makeTimestamp(),
      intent: SessionIntent.from("intent"),
      resumedFrom: null,
    });
    session.addOpenQuestion({
      text: OpenQuestionText.from("q?"),
      occurredAt: makeTimestamp(1700000000010),
    });
    session.pullEvents();
    void OpenQuestion;
    const turn = Turn.record({
      id: TurnId.from("01952f3c-2222-7000-8000-ffffffffff01"),
      workspaceId: ws,
      sessionId: session.getId(),
      summary: TurnSummary.from("S"),
      intent: TurnIntent.from("i"),
      outcome: TurnOutcome.from("o"),
      filesTouched: FilesTouched.create(["a.ts"]),
      linkedDecisions: LinkedDecisionIds.empty(),
      linkedLearnings: LinkedLearningIds.empty(),
      tags: makeTags(),
      confidence: Confidence.full(),
      occurredAt: makeTimestamp(),
    });
    turn.pullEvents();
    const ENTITY_X = "01952f3c-2222-7000-8000-eeeeeeeeee01";
    const ENTITY_Y = "01952f3c-2222-7000-8000-eeeeeeeeee02";
    const { EntityId } = await import(
      "../../../../src/modules/memory/domain/value-objects/entity-id.ts"
    );
    const relation = Relation.create({
      id: RelationId.from("01952f3c-2222-7000-8000-2222222222ab"),
      workspaceId: ws,
      from: RelationEndpoint.entity(EntityId.from(ENTITY_X)),
      to: RelationEndpoint.entity(EntityId.from(ENTITY_Y)),
      kind: RelationKind.references(),
      weight: Confidence.full(),
      occurredAt: makeTimestamp(),
    });
    relation.pullEvents();

    const snap = {
      ...emptySnapshot(),
      learnings: [learning],
      tasks: [task],
      turns: [turn],
      sessions: [session],
      relations: [relation],
    };
    const json = new JsonMemoryExporter().serialise(snap);
    const back = new JsonMemoryImporter().parse({ json, workspaceId: ws });
    expect(back.learnings.length).toBe(1);
    expect(back.tasks.length).toBe(1);
    expect(back.turns.length).toBe(1);
    expect(back.sessions.length).toBe(1);
    expect(back.relations.length).toBe(1);
    expect(back.sessions[0]?.getMetadata().openQuestions.length).toBe(1);
  });
});
