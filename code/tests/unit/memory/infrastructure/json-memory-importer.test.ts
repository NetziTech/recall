import { describe, expect, it } from "vitest";
import { JsonMemoryImporter } from "../../../../src/modules/memory/infrastructure/import-export/json-memory-importer.ts";
import { JsonMemoryExporter } from "../../../../src/modules/memory/infrastructure/import-export/json-memory-exporter.ts";
import type { MemorySnapshot } from "../../../../src/modules/memory/application/ports/out/memory-exporter.port.ts";
import { Decision } from "../../../../src/modules/memory/domain/aggregates/decision.ts";
import { Entity } from "../../../../src/modules/memory/domain/aggregates/entity.ts";
import { DecisionId } from "../../../../src/modules/memory/domain/value-objects/decision-id.ts";
import { EntityId } from "../../../../src/modules/memory/domain/value-objects/entity-id.ts";
import { DecisionTitle } from "../../../../src/modules/memory/domain/value-objects/decision-title.ts";
import { DecisionContent } from "../../../../src/modules/memory/domain/value-objects/decision-content.ts";
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
      content: DecisionContent.from("Long-form body"),
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
      content: DecisionContent.from("Long-form body"),
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

  // Coverage focus: exercise the "non-null" arm of every nullable
  // ternary in the per-kind builders (lastUsedMs, supersededBy,
  // consolidatedInto, description, dueAt, completedAt, intent, outcome,
  // endedAt, summary, nextSeed, resumedFrom, filesTouched non-empty,
  // linkedDecisions non-empty, linkedLearnings non-empty).
  // The round-trip-everything test above exercises the "null/empty"
  // arms; this one exercises the populated arms.
  it("rehydrates every nullable field when present (non-null branches)", () => {
    const ws = makeWorkspaceId();
    const importer = new JsonMemoryImporter();
    const envelope = {
      schemaVersion: 1,
      decisions: [
        {
          id: "01952f3c-2222-7000-8000-d00000000001",
          title: "T1",
          rationale: "R1",
          content: "Body 1",
          tags: ["t"],
          status: "active",
          supersededBy: "01952f3c-2222-7000-8000-d00000000002",
          confidence: 1.0,
          useCount: 5,
          lastUsedMs: 1700000010000,
          scope: { kind: "project", module: null },
          embeddingStatus: "pending",
          createdAtMs: 1700000000000,
          updatedAtMs: 1700000010000,
        },
      ],
      learnings: [
        {
          id: "01952f3c-2222-7000-8000-cccccccccc01",
          text: "L1",
          severity: "warning",
          tags: ["t"],
          confidence: 0.9,
          useCount: 3,
          lastUsedMs: 1700000020000,
          scope: { kind: "project", module: null },
          embeddingStatus: "pending",
          consolidatedInto: "01952f3c-2222-7000-8000-cccccccccc02",
          createdAtMs: 1700000000000,
          updatedAtMs: 1700000020000,
        },
      ],
      entities: [
        {
          id: "01952f3c-2222-7000-8000-eeeeeeeeee01",
          name: "Service",
          kind: "class",
          description: "non-empty",
          tags: [],
          confidence: 1.0,
          useCount: 2,
          lastUsedMs: 1700000030000,
          scope: { kind: "project", module: null },
          embeddingStatus: "pending",
          createdAtMs: 1700000000000,
          updatedAtMs: 1700000030000,
        },
      ],
      tasks: [
        {
          id: "01952f3c-2222-7000-8000-aaaaaaaaaa01",
          title: "T-task",
          description: "with-detail",
          status: "todo",
          priority: "high",
          tags: [],
          dueAtMs: 1700000086400000,
          createdAtMs: 1700000000000,
          updatedAtMs: 1700000040000,
          completedAtMs: 1700000040000,
        },
      ],
      turns: [
        {
          id: "01952f3c-2222-7000-8000-ffffffffff01",
          sessionId: "01952f3c-2222-7000-8000-111111111101",
          summary: "S",
          intent: "intent-x",
          outcome: "outcome-y",
          filesTouched: ["a.ts", "b.ts"],
          linkedDecisions: ["01952f3c-2222-7000-8000-d00000000001"],
          linkedLearnings: ["01952f3c-2222-7000-8000-cccccccccc01"],
          tags: [],
          confidence: 1.0,
          useCount: 1,
          lastUsedMs: 1700000050000,
          createdAtMs: 1700000000000,
        },
      ],
      sessions: [
        {
          id: "01952f3c-2222-7000-8000-111111111101",
          startedAtMs: 1700000000000,
          endedAtMs: 1700000060000,
          lastActivityAtMs: 1700000060000,
          idleTimeoutMs: 1_800_000,
          intent: "session-intent",
          summary: "session-summary",
          nextSeed: "seed-text",
          resumedFrom: "01952f3c-2222-7000-8000-111111111102",
          turnsCount: 1,
          openQuestions: [{ text: "q?", askedAtMs: 1700000005000 }],
        },
      ],
      relations: [],
    };
    const snap = importer.parse({ json: JSON.stringify(envelope), workspaceId: ws });

    // Decision: content present, supersededBy non-null, lastUsedMs non-null
    expect(snap.decisions.length).toBe(1);
    const dec = snap.decisions[0]!;
    expect(dec.getContent().toString()).toBe("Body 1");
    expect(dec.getSupersededBy()?.decisionId.toString()).toBe(
      "01952f3c-2222-7000-8000-d00000000002",
    );
    expect(dec.getLastUsed().kind).toBe("at");

    // Learning: consolidatedInto non-null + lastUsedMs non-null
    expect(snap.learnings.length).toBe(1);
    const learn = snap.learnings[0]!;
    expect(learn.getConsolidatedInto()?.toString()).toBe(
      "01952f3c-2222-7000-8000-cccccccccc02",
    );
    expect(learn.getLastUsed().kind).toBe("at");

    // Entity: non-empty description + lastUsedMs non-null
    expect(snap.entities.length).toBe(1);
    const ent = snap.entities[0]!;
    expect(ent.getDescription().toValue()).toEqual({
      kind: "known",
      text: "non-empty",
    });
    expect(ent.getLastUsed().kind).toBe("at");

    // Task: non-empty description + dueAt non-null + completedAt non-null
    expect(snap.tasks.length).toBe(1);
    const tsk = snap.tasks[0]!;
    expect(tsk.getDescription()?.toString()).toBe("with-detail");
    expect(tsk.getDueAt()).not.toBeNull();
    expect(tsk.getCompletedAt()).not.toBeNull();

    // Turn: intent + outcome + filesTouched non-empty + linkedDecisions
    //       + linkedLearnings + lastUsedMs all populated.
    expect(snap.turns.length).toBe(1);
    const trn = snap.turns[0]!;
    expect(trn.getIntent()?.toString()).toBe("intent-x");
    expect(trn.getOutcome()?.toString()).toBe("outcome-y");
    expect(trn.getFilesTouched().toArray().length).toBe(2);
    expect(trn.getLinkedDecisions().toArray().length).toBe(1);
    expect(trn.getLinkedLearnings().toArray().length).toBe(1);
    expect(trn.getLastUsed().kind).toBe("at");

    // Session: endedAt + intent + summary + nextSeed + resumedFrom all
    // populated.
    expect(snap.sessions.length).toBe(1);
    const sess = snap.sessions[0]!;
    expect(sess.getEndedAt()).not.toBeNull();
    expect(sess.getIntent()?.toString()).toBe("session-intent");
    expect(sess.getSummary()?.toString()).toBe("session-summary");
    expect(sess.getNextSeed()?.toString()).toBe("seed-text");
    expect(sess.getResumedFrom()?.toString()).toBe(
      "01952f3c-2222-7000-8000-111111111102",
    );
    expect(sess.getMetadata().openQuestions.length).toBe(1);
  });

  // Coverage: explicit "empty description"/"missing content" branches.
  // These differ from "null" via Zod schema (the wire allows null for
  // description; the importer also coerces empty strings to null/unknown).
  it("treats empty description strings and missing content as their null equivalents", () => {
    const ws = makeWorkspaceId();
    const importer = new JsonMemoryImporter();
    const envelope = {
      schemaVersion: 1,
      decisions: [
        {
          // No `content` key → fall back to rationale (line 279).
          id: "01952f3c-2222-7000-8000-d00000000003",
          title: "T",
          rationale: "fallback rationale",
          tags: [],
          status: "active",
          supersededBy: null,
          confidence: 1.0,
          useCount: 0,
          lastUsedMs: null,
          scope: { kind: "project", module: null },
          embeddingStatus: "pending",
          createdAtMs: 1700000000000,
          updatedAtMs: 1700000000000,
        },
      ],
      learnings: [],
      entities: [
        {
          id: "01952f3c-2222-7000-8000-eeeeeeeeee02",
          name: "Empty",
          kind: "class",
          // Empty description string → coerced to unknown via line 329.
          description: "",
          tags: [],
          confidence: 1.0,
          useCount: 0,
          lastUsedMs: null,
          scope: { kind: "project", module: null },
          embeddingStatus: "pending",
          createdAtMs: 1700000000000,
          updatedAtMs: 1700000000000,
        },
      ],
      tasks: [
        {
          id: "01952f3c-2222-7000-8000-aaaaaaaaaa02",
          title: "T",
          // Empty description string → coerced to null via line 362.
          description: "",
          status: "todo",
          priority: "high",
          tags: [],
          dueAtMs: null,
          createdAtMs: 1700000000000,
          updatedAtMs: 1700000000000,
          completedAtMs: null,
        },
      ],
      turns: [],
      sessions: [],
      relations: [],
    };
    const snap = importer.parse({ json: JSON.stringify(envelope), workspaceId: ws });
    expect(snap.decisions[0]!.getContent().toString()).toBe("fallback rationale");
    expect(snap.entities[0]!.getDescription().toValue()).toEqual({
      kind: "unknown",
      text: null,
    });
    expect(snap.tasks[0]!.getDescription()).toBeNull();
  });

  it("surfaces non-Error throwables from JSON.parse with a generic message", () => {
    const importer = new JsonMemoryImporter();
    // JSON.parse always throws a SyntaxError (which IS an Error), so we
    // patch JSON.parse to throw a non-Error value to exercise the
    // `cause instanceof Error ? ... : "unknown"` false branch at
    // line 218. The patch is scoped to a single call via a restore.
    const orig = JSON.parse;
    JSON.parse = (() => {
      throw "not-an-error-object";
    }) as typeof JSON.parse;
    try {
      expect(() =>
        importer.parse({ json: "{}", workspaceId: makeWorkspaceId() }),
      ).toThrow(/unknown/);
    } finally {
      JSON.parse = orig;
    }
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
