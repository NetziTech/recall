/**
 * Coverage-targeted tests for memory-domain value objects whose factory
 * length-caps and edge cases were under-exercised.
 *
 * Each block targets one VO and exercises the boundary cases that the
 * existing `value-objects.test.ts` does not yet cover (length cap,
 * newline rejection, dedup of linked id collections, last-used edge
 * arithmetic, etc.).
 */
import { describe, expect, it } from "vitest";

import { DecisionId } from "../../../../src/modules/memory/domain/value-objects/decision-id.ts";
import { DecisionStatus } from "../../../../src/modules/memory/domain/value-objects/decision-status.ts";
import { EntityDescription } from "../../../../src/modules/memory/domain/value-objects/entity-description.ts";
import { LastUsed } from "../../../../src/modules/memory/domain/value-objects/last-used.ts";
import { LearningId } from "../../../../src/modules/memory/domain/value-objects/learning-id.ts";
import { LinkedDecisionIds } from "../../../../src/modules/memory/domain/value-objects/linked-decision-ids.ts";
import { LinkedLearningIds } from "../../../../src/modules/memory/domain/value-objects/linked-learning-ids.ts";
import { OpenQuestion, OpenQuestionText } from "../../../../src/modules/memory/domain/value-objects/open-question.ts";
import { RelationEndpoint } from "../../../../src/modules/memory/domain/value-objects/relation-endpoint.ts";
import { Scope } from "../../../../src/modules/memory/domain/value-objects/scope.ts";
import { SessionIntent } from "../../../../src/modules/memory/domain/value-objects/session-intent.ts";
import { SessionMetadata } from "../../../../src/modules/memory/domain/value-objects/session-metadata.ts";
import { SessionNextSeed } from "../../../../src/modules/memory/domain/value-objects/session-next-seed.ts";
import { SessionSummary } from "../../../../src/modules/memory/domain/value-objects/session-summary.ts";
import { TaskDescription } from "../../../../src/modules/memory/domain/value-objects/task-description.ts";
import { TaskTitle } from "../../../../src/modules/memory/domain/value-objects/task-title.ts";
import { UseCount } from "../../../../src/modules/memory/domain/value-objects/use-count.ts";

import { InvalidInputError } from "../../../../src/shared/domain/errors/invalid-input-error.ts";
import { Timestamp } from "../../../../src/shared/domain/value-objects/timestamp.ts";

import {
  ANCHOR_TIME_MS,
  FIXED_DECISION_UUID,
  FIXED_LEARNING_UUID,
} from "../../../helpers/factories.ts";

const ts = (ms: number = ANCHOR_TIME_MS): Timestamp => Timestamp.fromEpochMs(ms);

describe("TaskTitle length cap", () => {
  it("accepts at the cap (500 chars)", () => {
    const at = "a".repeat(500);
    expect(TaskTitle.from(at).toString().length).toBe(500);
  });

  it("rejects above the cap", () => {
    expect(() => TaskTitle.from("a".repeat(501))).toThrow(InvalidInputError);
  });

  it("rejects newline characters", () => {
    expect(() => TaskTitle.from("title\nmore")).toThrow(InvalidInputError);
    expect(() => TaskTitle.from("title\rmore")).toThrow(InvalidInputError);
  });
});

describe("TaskDescription length cap", () => {
  it("accepts at cap and rejects above", () => {
    expect(TaskDescription.from("a".repeat(5000)).toString().length).toBe(5000);
    expect(() => TaskDescription.from("a".repeat(5001))).toThrow(
      InvalidInputError,
    );
  });
});

describe("SessionIntent length cap", () => {
  it("accepts at cap and rejects above", () => {
    expect(SessionIntent.from("a".repeat(1000)).toString().length).toBe(1000);
    expect(() => SessionIntent.from("a".repeat(1001))).toThrow(InvalidInputError);
  });
});

describe("SessionSummary length cap", () => {
  it("accepts at cap and rejects above", () => {
    expect(SessionSummary.from("a".repeat(8000)).toString().length).toBe(8000);
    expect(() => SessionSummary.from("a".repeat(8001))).toThrow(
      InvalidInputError,
    );
  });
});

describe("SessionNextSeed length cap", () => {
  it("accepts at cap and rejects above", () => {
    expect(SessionNextSeed.from("a".repeat(2000)).toString().length).toBe(2000);
    expect(() => SessionNextSeed.from("a".repeat(2001))).toThrow(
      InvalidInputError,
    );
  });
});

describe("EntityDescription edges", () => {
  it("of() trims whitespace and isKnown()", () => {
    const d = EntityDescription.of("  hello  ");
    expect(d.toStringOrNull()).toBe("hello");
    expect(d.isKnown()).toBe(true);
    expect(d.isUnknown()).toBe(false);
  });

  it("unknown() returns the unknown variant", () => {
    const u = EntityDescription.unknown();
    expect(u.isUnknown()).toBe(true);
    expect(u.isKnown()).toBe(false);
    expect(u.toStringOrNull()).toBeNull();
  });

  it("toValue() returns canonical discriminated-union view", () => {
    expect(EntityDescription.of("hi").toValue().kind).toBe("known");
    expect(EntityDescription.unknown().toValue().kind).toBe("unknown");
  });

  it("rejects empty / whitespace-only", () => {
    expect(() => EntityDescription.of("")).toThrow(InvalidInputError);
    expect(() => EntityDescription.of("    ")).toThrow(InvalidInputError);
  });

  it("rejects above the cap (5000 chars)", () => {
    expect(() => EntityDescription.of("a".repeat(5001))).toThrow(InvalidInputError);
  });

  it("equals() compares variants and inner text", () => {
    expect(EntityDescription.unknown().equals(EntityDescription.unknown())).toBe(true);
    expect(EntityDescription.of("a").equals(EntityDescription.of("a"))).toBe(true);
    expect(EntityDescription.of("a").equals(EntityDescription.of("b"))).toBe(false);
    expect(EntityDescription.of("a").equals(EntityDescription.unknown())).toBe(false);
    const sample = EntityDescription.of("hi");
    expect(sample.equals(sample)).toBe(true);
  });
});

describe("LinkedDecisionIds", () => {
  it("empty() and create([]) both produce isEmpty() = true", () => {
    expect(LinkedDecisionIds.empty().isEmpty()).toBe(true);
    expect(LinkedDecisionIds.create([]).isEmpty()).toBe(true);
  });

  it("create() rejects an undefined slot in the array", () => {
    const arr = [DecisionId.from(FIXED_DECISION_UUID), undefined] as unknown as DecisionId[];
    expect(() => LinkedDecisionIds.create(arr)).toThrow(InvalidInputError);
  });

  it("create() rejects duplicates", () => {
    const id = DecisionId.from(FIXED_DECISION_UUID);
    expect(() => LinkedDecisionIds.create([id, id])).toThrow(InvalidInputError);
  });

  it("size + contains + toArray + equals", () => {
    const id = DecisionId.from(FIXED_DECISION_UUID);
    const a = LinkedDecisionIds.create([id]);
    const b = LinkedDecisionIds.create([id]);
    expect(a.size()).toBe(1);
    expect(a.contains(id)).toBe(true);
    expect(a.toArray().length).toBe(1);
    expect(a.equals(b)).toBe(true);
    expect(a.equals(a)).toBe(true);
  });

  it("equals returns false on different sizes", () => {
    const id = DecisionId.from(FIXED_DECISION_UUID);
    expect(
      LinkedDecisionIds.create([id]).equals(LinkedDecisionIds.empty()),
    ).toBe(false);
  });

  it("contains returns false when id absent", () => {
    const a = LinkedDecisionIds.empty();
    expect(a.contains(DecisionId.from(FIXED_DECISION_UUID))).toBe(false);
  });
});

describe("LinkedLearningIds", () => {
  it("empty + create([]) → isEmpty true", () => {
    expect(LinkedLearningIds.empty().isEmpty()).toBe(true);
    expect(LinkedLearningIds.create([]).isEmpty()).toBe(true);
  });

  it("create() rejects undefined slot", () => {
    const arr = [LearningId.from(FIXED_LEARNING_UUID), undefined] as unknown as LearningId[];
    expect(() => LinkedLearningIds.create(arr)).toThrow(InvalidInputError);
  });

  it("create() rejects duplicates", () => {
    const id = LearningId.from(FIXED_LEARNING_UUID);
    expect(() => LinkedLearningIds.create([id, id])).toThrow(InvalidInputError);
  });

  it("contains + size + equals", () => {
    const id = LearningId.from(FIXED_LEARNING_UUID);
    const a = LinkedLearningIds.create([id]);
    const b = LinkedLearningIds.create([id]);
    expect(a.size()).toBe(1);
    expect(a.contains(id)).toBe(true);
    expect(a.equals(b)).toBe(true);
    expect(a.equals(a)).toBe(true);
    expect(a.equals(LinkedLearningIds.empty())).toBe(false);
    expect(LinkedLearningIds.empty().contains(id)).toBe(false);
  });
});

describe("LastUsed and UseCount", () => {
  it("LastUsed.never() — hasBeenUsed false, equality works", () => {
    const a = LastUsed.never();
    const b = LastUsed.never();
    expect(a.hasBeenUsed()).toBe(false);
    expect(a.equals(b)).toBe(true);
    expect(a.equals(a)).toBe(true);
  });

  it("LastUsed.at() carries the timestamp and equals when ts equal", () => {
    const a = LastUsed.at(ts());
    const b = LastUsed.at(ts());
    expect(a.equals(b)).toBe(true);
    expect(a.hasBeenUsed()).toBe(true);
  });

  it("LastUsed.never vs at → not equal", () => {
    expect(LastUsed.never().equals(LastUsed.at(ts()))).toBe(false);
    expect(LastUsed.at(ts()).equals(LastUsed.never())).toBe(false);
  });

  it("UseCount.zero + increment + equals + toNumber", () => {
    const z = UseCount.zero();
    const one = z.increment();
    expect(z.toNumber()).toBe(0);
    expect(one.toNumber()).toBe(1);
    expect(z.equals(UseCount.zero())).toBe(true);
    expect(z.equals(one)).toBe(false);
  });

  it("UseCount.of rejects negatives + non-integers", () => {
    expect(() => UseCount.of(-1)).toThrow(InvalidInputError);
    expect(() => UseCount.of(1.5)).toThrow(InvalidInputError);
  });
});

describe("DecisionStatus extra", () => {
  it("DecisionStatus.create rejects unknown values", () => {
    expect(() => DecisionStatus.create("nope")).toThrow(InvalidInputError);
  });
});

describe("Scope.create branches", () => {
  it("creates project scope, ignoring moduleName", () => {
    const s = Scope.create("project", "ignored");
    expect(s.isProject()).toBe(true);
    expect(s.module).toBeNull();
  });

  it("creates module scope with a name", () => {
    const s = Scope.create("module", "memory");
    expect(s.isModule()).toBe(true);
    expect(s.module).toBe("memory");
  });

  it("rejects module scope without a name", () => {
    expect(() => Scope.create("module", null)).toThrow(InvalidInputError);
  });

  it("rejects unknown kind", () => {
    expect(() => Scope.create("global", null)).toThrow(InvalidInputError);
  });

  it("rejects non-string kind", () => {
    expect(() =>
      Scope.create(42 as unknown as string, null),
    ).toThrow(InvalidInputError);
  });

  it("toValue() returns canonical discriminated-union view", () => {
    const proj = Scope.project().toValue();
    expect(proj.kind).toBe("project");
    expect(proj.module).toBeNull();
    const mod = Scope.module("billing").toValue();
    expect(mod.kind).toBe("module");
    expect(mod.module).toBe("billing");
  });
});

describe("SessionMetadata", () => {
  it("empty() returns stable empty instance", () => {
    expect(SessionMetadata.empty().openQuestions.length).toBe(0);
  });

  it("with question added preserves prior open questions", () => {
    const md = SessionMetadata.empty().withOpenQuestionAdded(
      OpenQuestion.from("why?", ts()),
    );
    expect(md.openQuestions.length).toBe(1);
  });

  it("withOpenQuestionAdded is idempotent for duplicate text", () => {
    const oq = OpenQuestion.from("why?", ts());
    const a = SessionMetadata.empty().withOpenQuestionAdded(oq);
    const b = a.withOpenQuestionAdded(oq);
    expect(a).toBe(b);
  });

  it("withOpenQuestionResolved removes by text", () => {
    const oq = OpenQuestion.from("why?", ts());
    const md = SessionMetadata.empty().withOpenQuestionAdded(oq);
    const resolved = md.withOpenQuestionResolved(OpenQuestionText.from("why?"));
    expect(resolved.openQuestions.length).toBe(0);
    // idempotent on missing text
    const resolvedAgain = resolved.withOpenQuestionResolved(
      OpenQuestionText.from("why?"),
    );
    expect(resolvedAgain).toBe(resolved);
  });

  it("hasOpenQuestion returns true / false correctly", () => {
    const oq = OpenQuestion.from("why?", ts());
    const md = SessionMetadata.empty().withOpenQuestionAdded(oq);
    expect(md.hasOpenQuestion(OpenQuestionText.from("why?"))).toBe(true);
    expect(md.hasOpenQuestion(OpenQuestionText.from("how?"))).toBe(false);
  });

  it("of() builds from a frozen list", () => {
    const md = SessionMetadata.of([OpenQuestion.from("a?", ts())]);
    expect(md.openQuestions.length).toBe(1);
  });

  it("equals: empty = empty, with-questions different sizes → not equal", () => {
    const a = SessionMetadata.empty();
    const b = SessionMetadata.empty();
    expect(a.equals(b)).toBe(true);
    expect(a.equals(a)).toBe(true);
    const withQuestion = a.withOpenQuestionAdded(
      OpenQuestion.from("why?", ts()),
    );
    expect(a.equals(withQuestion)).toBe(false);
  });

  it("equals: same questions → equal; different question text → not equal", () => {
    const a = SessionMetadata.of([OpenQuestion.from("a?", ts())]);
    const b = SessionMetadata.of([OpenQuestion.from("a?", ts())]);
    expect(a.equals(b)).toBe(true);
    const c = SessionMetadata.of([OpenQuestion.from("b?", ts())]);
    expect(a.equals(c)).toBe(false);
  });
});

describe("OpenQuestionText / OpenQuestion edges", () => {
  it("from() trims and validates non-empty", () => {
    expect(OpenQuestionText.from("  why?  ").toString()).toBe("why?");
    expect(() => OpenQuestionText.from("")).toThrow(InvalidInputError);
  });

  it("OpenQuestion.equals respects both fields", () => {
    const a = OpenQuestion.from("why?", ts());
    const b = OpenQuestion.from("why?", ts());
    expect(a.equals(b)).toBe(true);
    expect(a.equals(a)).toBe(true);
    const diffText = OpenQuestion.from("how?", ts());
    expect(a.equals(diffText)).toBe(false);
    const diffTime = OpenQuestion.from("why?", ts(ANCHOR_TIME_MS + 1));
    expect(a.equals(diffTime)).toBe(false);
  });

  it("OpenQuestion.of preserves the wrapped text", () => {
    const txt = OpenQuestionText.from("why?");
    const oq = OpenQuestion.of(txt, ts());
    expect(oq.text.equals(txt)).toBe(true);
  });
});

describe("RelationEndpoint kinds", () => {
  it("decision endpoint compares true to itself", () => {
    const a = RelationEndpoint.decision(DecisionId.from(FIXED_DECISION_UUID));
    const b = RelationEndpoint.decision(DecisionId.from(FIXED_DECISION_UUID));
    expect(a.equals(b)).toBe(true);
    expect(a.equals(a)).toBe(true);
  });

  it("learning endpoint compares true to itself", () => {
    const a = RelationEndpoint.learning(LearningId.from(FIXED_LEARNING_UUID));
    const b = RelationEndpoint.learning(LearningId.from(FIXED_LEARNING_UUID));
    expect(a.equals(b)).toBe(true);
  });

  it("two different kinds → not equal", () => {
    const a = RelationEndpoint.decision(DecisionId.from(FIXED_DECISION_UUID));
    const b = RelationEndpoint.learning(LearningId.from(FIXED_LEARNING_UUID));
    expect(a.equals(b)).toBe(false);
  });
});
