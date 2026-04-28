import { describe, expect, it } from "vitest";
import { Relation } from "../../../../src/modules/memory/domain/aggregates/relation.ts";
import { RelationId } from "../../../../src/modules/memory/domain/value-objects/relation-id.ts";
import { RelationKind } from "../../../../src/modules/memory/domain/value-objects/relation-kind.ts";
import { RelationEndpoint } from "../../../../src/modules/memory/domain/value-objects/relation-endpoint.ts";
import { EntityId } from "../../../../src/modules/memory/domain/value-objects/entity-id.ts";
import { DecisionId } from "../../../../src/modules/memory/domain/value-objects/decision-id.ts";
import { LearningId } from "../../../../src/modules/memory/domain/value-objects/learning-id.ts";
import { TaskId } from "../../../../src/modules/memory/domain/value-objects/task-id.ts";
import { RelationCreated } from "../../../../src/modules/memory/domain/events/relation-created.ts";
import { RelationSelfLoopError } from "../../../../src/modules/memory/domain/errors/relation-self-loop-error.ts";
import { InvalidInputError } from "../../../../src/shared/domain/errors/invalid-input-error.ts";
import {
  ANCHOR_TIME_MS,
  FIXED_RELATION_UUID,
  FIXED_ENTITY_UUID,
  FIXED_DECISION_UUID,
  FIXED_LEARNING_UUID,
  FIXED_TASK_UUID,
  makeConfidence,
  makeTimestamp,
  makeWorkspaceId,
} from "../../../helpers/factories.ts";

const SECOND_ENTITY_UUID = "01952f3c-2222-7000-8000-aaaaaaaaaaaa";

describe("RelationEndpoint", () => {
  it("decision/learning/entity/task factories", () => {
    const dec = RelationEndpoint.decision(DecisionId.from(FIXED_DECISION_UUID));
    expect(dec.kind).toBe("decision");
    const lrn = RelationEndpoint.learning(LearningId.from(FIXED_LEARNING_UUID));
    expect(lrn.kind).toBe("learning");
    const ent = RelationEndpoint.entity(EntityId.from(FIXED_ENTITY_UUID));
    expect(ent.kind).toBe("entity");
    const tsk = RelationEndpoint.task(TaskId.from(FIXED_TASK_UUID));
    expect(tsk.kind).toBe("task");
  });

  it("create dispatches by kind", () => {
    expect(
      RelationEndpoint.create("entity", FIXED_ENTITY_UUID).kind,
    ).toBe("entity");
    expect(
      RelationEndpoint.create("decision", FIXED_DECISION_UUID).kind,
    ).toBe("decision");
    expect(
      RelationEndpoint.create("learning", FIXED_LEARNING_UUID).kind,
    ).toBe("learning");
    expect(RelationEndpoint.create("task", FIXED_TASK_UUID).kind).toBe("task");
  });

  it("create rejects unknown kind", () => {
    expect(() =>
      RelationEndpoint.create("turn", FIXED_DECISION_UUID),
    ).toThrow(InvalidInputError);
  });

  it("create rejects non-string kind", () => {
    expect(() =>
      RelationEndpoint.create(123 as unknown as string, FIXED_ENTITY_UUID),
    ).toThrow(InvalidInputError);
  });

  it("idAsString returns the underlying id", () => {
    const e = RelationEndpoint.entity(EntityId.from(FIXED_ENTITY_UUID));
    expect(e.idAsString()).toBe(FIXED_ENTITY_UUID);
  });

  it("toValue returns the discriminated union", () => {
    const e = RelationEndpoint.entity(EntityId.from(FIXED_ENTITY_UUID));
    const v = e.toValue();
    expect(v.kind).toBe("entity");
    if (v.kind === "entity") expect(v.id.toString()).toBe(FIXED_ENTITY_UUID);
  });

  it("equals compares kind + id (cross-kind same-id is NOT equal)", () => {
    const a = RelationEndpoint.entity(EntityId.from(FIXED_ENTITY_UUID));
    const b = RelationEndpoint.entity(EntityId.from(FIXED_ENTITY_UUID));
    const c = RelationEndpoint.decision(DecisionId.from(FIXED_ENTITY_UUID));
    expect(a.equals(b)).toBe(true);
    expect(a.equals(a)).toBe(true);
    expect(a.equals(c)).toBe(false);
  });

  it("isKind type guard", () => {
    expect(RelationEndpoint.isKind("entity")).toBe(true);
    expect(RelationEndpoint.isKind("turn")).toBe(false);
  });
});

describe("RelationKind", () => {
  it("factories", () => {
    expect(RelationKind.references().toString()).toBe("references");
    expect(RelationKind.supersedes().toString()).toBe("supersedes");
    expect(RelationKind.dependsOn().toString()).toBe("depends_on");
    expect(RelationKind.relatedTo().toString()).toBe("related_to");
  });

  it("create rejects unknown / empty / non-string", () => {
    expect(() => RelationKind.create("nope")).toThrow(InvalidInputError);
    expect(() => RelationKind.create("")).toThrow(InvalidInputError);
    expect(() =>
      RelationKind.create(undefined as unknown as string),
    ).toThrow(InvalidInputError);
  });
});

describe("Relation (aggregate)", () => {
  const from = RelationEndpoint.entity(EntityId.from(FIXED_ENTITY_UUID));
  const to = RelationEndpoint.entity(EntityId.from(SECOND_ENTITY_UUID));

  it("create succeeds with different endpoints", () => {
    const r = Relation.create({
      id: RelationId.from(FIXED_RELATION_UUID),
      workspaceId: makeWorkspaceId(),
      from,
      to,
      kind: RelationKind.references(),
      weight: makeConfidence(),
      occurredAt: makeTimestamp(),
    });
    expect(r.getId().toString()).toBe(FIXED_RELATION_UUID);
    expect(r.getKind().equals(RelationKind.references())).toBe(true);
    expect(r.getFrom().equals(from)).toBe(true);
    expect(r.getTo().equals(to)).toBe(true);
    expect(r.getWeight().toNumber()).toBe(1);
    const events = r.pullEvents();
    expect(events.length).toBe(1);
    expect(events[0]).toBeInstanceOf(RelationCreated);
  });

  it("rejects self-loop (from === to)", () => {
    expect(() =>
      Relation.create({
        id: RelationId.from(FIXED_RELATION_UUID),
        workspaceId: makeWorkspaceId(),
        from,
        to: from,
        kind: RelationKind.references(),
        weight: makeConfidence(),
        occurredAt: makeTimestamp(ANCHOR_TIME_MS),
      }),
    ).toThrow(RelationSelfLoopError);
  });

  it("rehydrate does not check self-loop and emits no events", () => {
    const r = Relation.rehydrate({
      id: RelationId.from(FIXED_RELATION_UUID),
      workspaceId: makeWorkspaceId(),
      from,
      to,
      kind: RelationKind.dependsOn(),
      weight: makeConfidence(0.7),
      createdAt: makeTimestamp(),
    });
    expect(r.pullEvents()).toHaveLength(0);
    expect(r.getKind().equals(RelationKind.dependsOn())).toBe(true);
  });
});
