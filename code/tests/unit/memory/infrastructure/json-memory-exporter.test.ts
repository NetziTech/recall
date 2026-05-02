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
});
