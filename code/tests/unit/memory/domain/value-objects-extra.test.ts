/**
 * Supplementary VO tests for memory-domain value objects whose
 * behaviour is NOT covered by the consolidated `value-objects.test.ts`
 * (mostly compound VOs and session-flavoured fields).
 */
import { describe, expect, it } from "vitest";
import { LinkedDecisionIds } from "../../../../src/modules/memory/domain/value-objects/linked-decision-ids.ts";
import { LinkedLearningIds } from "../../../../src/modules/memory/domain/value-objects/linked-learning-ids.ts";
import { RelationKind } from "../../../../src/modules/memory/domain/value-objects/relation-kind.ts";
import { SessionMetadata } from "../../../../src/modules/memory/domain/value-objects/session-metadata.ts";
import { OpenQuestion, OpenQuestionText } from "../../../../src/modules/memory/domain/value-objects/open-question.ts";
import { SessionIntent } from "../../../../src/modules/memory/domain/value-objects/session-intent.ts";
import { SessionSummary } from "../../../../src/modules/memory/domain/value-objects/session-summary.ts";
import { SessionNextSeed } from "../../../../src/modules/memory/domain/value-objects/session-next-seed.ts";
import { EntityDescription } from "../../../../src/modules/memory/domain/value-objects/entity-description.ts";
import { DecisionId } from "../../../../src/modules/memory/domain/value-objects/decision-id.ts";
import { LearningId } from "../../../../src/modules/memory/domain/value-objects/learning-id.ts";
import { InvalidInputError } from "../../../../src/shared/domain/errors/invalid-input-error.ts";
import {
  ANCHOR_TIME_MS,
  FIXED_DECISION_UUID,
  FIXED_LEARNING_UUID,
  makeTimestamp,
} from "../../../helpers/factories.ts";

const SECOND_DECISION = "01952f3c-2222-7000-8000-bbbbbbbbbb02";
const SECOND_LEARNING = "01952f3c-2222-7000-8000-cccccccccc02";

describe("LinkedDecisionIds", () => {
  it("empty + isEmpty + size", () => {
    expect(LinkedDecisionIds.empty().isEmpty()).toBe(true);
    expect(LinkedDecisionIds.empty().size()).toBe(0);
  });

  it("create + contains + toArray", () => {
    const ids = LinkedDecisionIds.create([
      DecisionId.from(FIXED_DECISION_UUID),
      DecisionId.from(SECOND_DECISION),
    ]);
    expect(ids.size()).toBe(2);
    expect(ids.contains(DecisionId.from(FIXED_DECISION_UUID))).toBe(true);
    expect(ids.toArray().length).toBe(2);
  });

  it("rejects duplicates", () => {
    expect(() =>
      LinkedDecisionIds.create([
        DecisionId.from(FIXED_DECISION_UUID),
        DecisionId.from(FIXED_DECISION_UUID),
      ]),
    ).toThrow(InvalidInputError);
  });

  it("equals reflects ordered content", () => {
    const a = LinkedDecisionIds.create([DecisionId.from(FIXED_DECISION_UUID)]);
    const b = LinkedDecisionIds.create([DecisionId.from(FIXED_DECISION_UUID)]);
    expect(a.equals(b)).toBe(true);
    const c = LinkedDecisionIds.create([
      DecisionId.from(FIXED_DECISION_UUID),
      DecisionId.from(SECOND_DECISION),
    ]);
    expect(a.equals(c)).toBe(false);
  });
});

describe("LinkedLearningIds", () => {
  it("create + contains + size", () => {
    const ids = LinkedLearningIds.create([
      LearningId.from(FIXED_LEARNING_UUID),
    ]);
    expect(ids.size()).toBe(1);
    expect(ids.contains(LearningId.from(FIXED_LEARNING_UUID))).toBe(true);
  });

  it("rejects duplicates", () => {
    expect(() =>
      LinkedLearningIds.create([
        LearningId.from(FIXED_LEARNING_UUID),
        LearningId.from(FIXED_LEARNING_UUID),
      ]),
    ).toThrow(InvalidInputError);
  });

  it("empty equals empty", () => {
    expect(LinkedLearningIds.empty().equals(LinkedLearningIds.empty())).toBe(
      true,
    );
  });

  it("equals returns false on length mismatch", () => {
    const a = LinkedLearningIds.empty();
    const b = LinkedLearningIds.create([LearningId.from(SECOND_LEARNING)]);
    expect(a.equals(b)).toBe(false);
  });
});

describe("RelationKind", () => {
  it("factories cover the four kinds", () => {
    expect(RelationKind.references().toString()).toBe("references");
    expect(RelationKind.supersedes().toString()).toBe("supersedes");
    expect(RelationKind.dependsOn().toString()).toBe("depends_on");
    expect(RelationKind.relatedTo().toString()).toBe("related_to");
  });

  it("create accepts the four kinds", () => {
    expect(RelationKind.create("references").toString()).toBe("references");
    expect(RelationKind.create("supersedes").toString()).toBe("supersedes");
  });

  it("rejects unknown / empty / non-string", () => {
    expect(() => RelationKind.create("foo")).toThrow(InvalidInputError);
    expect(() => RelationKind.create("")).toThrow(InvalidInputError);
    expect(() =>
      RelationKind.create(123 as unknown as string),
    ).toThrow(InvalidInputError);
  });

  it("isValue type-guard", () => {
    expect(RelationKind.isValue("references")).toBe(true);
    expect(RelationKind.isValue("nope")).toBe(false);
  });

  it("equals", () => {
    expect(
      RelationKind.references().equals(RelationKind.references()),
    ).toBe(true);
    expect(
      RelationKind.references().equals(RelationKind.supersedes()),
    ).toBe(false);
  });
});

describe("OpenQuestion / OpenQuestionText", () => {
  it("OpenQuestionText trims and rejects empty", () => {
    expect(OpenQuestionText.from("  q  ").toString()).toBe("q");
    expect(() => OpenQuestionText.from("")).toThrow(InvalidInputError);
  });

  it("OpenQuestionText rejects oversized", () => {
    expect(() => OpenQuestionText.from("x".repeat(1001))).toThrow(
      InvalidInputError,
    );
  });

  it("OpenQuestion.from + equals", () => {
    const q1 = OpenQuestion.from("ask?", makeTimestamp());
    const q2 = OpenQuestion.from("ask?", makeTimestamp());
    expect(q1.equals(q2)).toBe(true);
    const q3 = OpenQuestion.from("ask?", makeTimestamp(ANCHOR_TIME_MS + 1));
    expect(q1.equals(q3)).toBe(false);
    const q4 = OpenQuestion.from("other?", makeTimestamp());
    expect(q1.equals(q4)).toBe(false);
  });
});

describe("SessionMetadata", () => {
  it("empty + of", () => {
    expect(SessionMetadata.empty().openQuestions.length).toBe(0);
    const s = SessionMetadata.of([
      OpenQuestion.from("ask?", makeTimestamp()),
    ]);
    expect(s.openQuestions.length).toBe(1);
  });

  it("withOpenQuestionAdded is idempotent on duplicates", () => {
    const meta = SessionMetadata.empty();
    const q = OpenQuestion.from("ask?", makeTimestamp());
    const next = meta.withOpenQuestionAdded(q);
    expect(next.openQuestions.length).toBe(1);
    const same = next.withOpenQuestionAdded(
      OpenQuestion.from("ask?", makeTimestamp(ANCHOR_TIME_MS + 100)),
    );
    expect(same).toBe(next);
  });

  it("withOpenQuestionResolved removes by text and is idempotent on miss", () => {
    const text = OpenQuestionText.from("q?");
    const meta = SessionMetadata.empty().withOpenQuestionAdded(
      OpenQuestion.of(text, makeTimestamp()),
    );
    const resolved = meta.withOpenQuestionResolved(text);
    expect(resolved.openQuestions.length).toBe(0);
    const idempotent = resolved.withOpenQuestionResolved(text);
    expect(idempotent).toBe(resolved);
  });

  it("hasOpenQuestion returns false on empty", () => {
    expect(
      SessionMetadata.empty().hasOpenQuestion(OpenQuestionText.from("q?")),
    ).toBe(false);
  });

  it("equals reflects ordered content", () => {
    const a = SessionMetadata.empty();
    const b = SessionMetadata.empty();
    expect(a.equals(b)).toBe(true);
    const c = a.withOpenQuestionAdded(OpenQuestion.from("q?", makeTimestamp()));
    expect(a.equals(c)).toBe(false);
  });
});

describe("SessionIntent / SessionSummary / SessionNextSeed", () => {
  it("SessionIntent trims and caps", () => {
    expect(SessionIntent.from("  intent  ").toString()).toBe("intent");
    expect(() => SessionIntent.from("")).toThrow(InvalidInputError);
  });

  it("SessionSummary trims", () => {
    expect(SessionSummary.from("  done  ").toString()).toBe("done");
    expect(() => SessionSummary.from("")).toThrow(InvalidInputError);
  });

  it("SessionNextSeed trims", () => {
    expect(SessionNextSeed.from("  seed  ").toString()).toBe("seed");
    expect(() => SessionNextSeed.from("")).toThrow(InvalidInputError);
  });
});

describe("EntityDescription", () => {
  it("unknown variant returns null on toStringOrNull", () => {
    expect(EntityDescription.unknown().toStringOrNull()).toBe(null);
  });

  it("of variant trims and validates", () => {
    expect(EntityDescription.of("  d  ").toStringOrNull()).toBe("d");
    expect(() => EntityDescription.of("")).toThrow(InvalidInputError);
  });

  it("equals: unknown == unknown, of(x) == of(x)", () => {
    expect(EntityDescription.unknown().equals(EntityDescription.unknown())).toBe(
      true,
    );
    expect(
      EntityDescription.of("d").equals(EntityDescription.of("d")),
    ).toBe(true);
    expect(
      EntityDescription.of("d").equals(EntityDescription.unknown()),
    ).toBe(false);
    expect(
      EntityDescription.of("a").equals(EntityDescription.of("b")),
    ).toBe(false);
  });
});
