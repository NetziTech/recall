import { describe, expect, it } from "vitest";
import { Learning } from "../../../../src/modules/memory/domain/aggregates/learning.ts";
import { LearningId } from "../../../../src/modules/memory/domain/value-objects/learning-id.ts";
import { LearningSeverity } from "../../../../src/modules/memory/domain/value-objects/learning-severity.ts";
import { LearningText } from "../../../../src/modules/memory/domain/value-objects/learning-text.ts";
import { Scope } from "../../../../src/modules/memory/domain/value-objects/scope.ts";
import { EmbeddingStatus } from "../../../../src/modules/memory/domain/value-objects/embedding-status.ts";
import { LastUsed } from "../../../../src/modules/memory/domain/value-objects/last-used.ts";
import { UseCount } from "../../../../src/modules/memory/domain/value-objects/use-count.ts";
import { LearningRegistered } from "../../../../src/modules/memory/domain/events/learning-registered.ts";
import { LearningConsolidated } from "../../../../src/modules/memory/domain/events/learning-consolidated.ts";
import { LearningUsed } from "../../../../src/modules/memory/domain/events/learning-used.ts";
import { LearningSelfConsolidationError } from "../../../../src/modules/memory/domain/errors/learning-self-consolidation-error.ts";
import { LearningAlreadyConsolidatedError } from "../../../../src/modules/memory/domain/errors/learning-already-consolidated-error.ts";
import {
  ANCHOR_TIME_MS,
  FIXED_LEARNING_UUID,
  makeConfidence,
  makeTags,
  makeTimestamp,
  makeWorkspaceId,
} from "../../../helpers/factories.ts";

const TARGET_LEARNING_UUID = "01952f3b-7d8c-7000-8000-eeeeeeeeeeee";

function makeLearning(): Learning {
  return Learning.register({
    id: LearningId.from(FIXED_LEARNING_UUID),
    workspaceId: makeWorkspaceId(),
    text: LearningText.from("Always canonicalise paths before comparing"),
    severity: LearningSeverity.tip(),
    tags: makeTags(["fs", "pitfall"]),
    confidence: makeConfidence(),
    scope: Scope.project(),
    embeddingStatus: EmbeddingStatus.pending(),
    occurredAt: makeTimestamp(),
  });
}

describe("Learning (aggregate)", () => {
  describe("register", () => {
    it("creates an active learning with defaults", () => {
      const l = makeLearning();
      expect(l.getUseCount().toNumber()).toBe(0);
      expect(l.getLastUsed().hasBeenUsed()).toBe(false);
      expect(l.getConsolidatedInto()).toBe(null);
      expect(l.isActive()).toBe(true);
      expect(l.getCreatedAt().equals(l.getUpdatedAt())).toBe(true);
    });

    it("emits LearningRegistered", () => {
      const l = makeLearning();
      const events = l.pullEvents();
      expect(events.length).toBe(1);
      expect(events[0]).toBeInstanceOf(LearningRegistered);
    });
  });

  describe("markUsed", () => {
    it("increments useCount and emits LearningUsed", () => {
      const l = makeLearning();
      l.pullEvents();
      l.markUsed({ occurredAt: makeTimestamp(ANCHOR_TIME_MS + 100) });
      expect(l.getUseCount().toNumber()).toBe(1);
      expect(l.getLastUsed().hasBeenUsed()).toBe(true);
      const events = l.pullEvents();
      expect(events.length).toBe(1);
      expect(events[0]).toBeInstanceOf(LearningUsed);
    });
  });

  describe("consolidateInto", () => {
    it("folds the learning into a target", () => {
      const l = makeLearning();
      l.pullEvents();
      const targetId = LearningId.from(TARGET_LEARNING_UUID);
      l.consolidateInto({
        targetId,
        occurredAt: makeTimestamp(ANCHOR_TIME_MS + 100),
      });
      expect(l.getConsolidatedInto()?.equals(targetId)).toBe(true);
      expect(l.isActive()).toBe(false);
      const events = l.pullEvents();
      expect(events.length).toBe(1);
      expect(events[0]).toBeInstanceOf(LearningConsolidated);
    });

    it("rejects self-consolidation", () => {
      const l = makeLearning();
      expect(() =>
        l.consolidateInto({
          targetId: LearningId.from(FIXED_LEARNING_UUID),
          occurredAt: makeTimestamp(ANCHOR_TIME_MS + 100),
        }),
      ).toThrow(LearningSelfConsolidationError);
    });

    it("rejects re-consolidation", () => {
      const l = makeLearning();
      l.consolidateInto({
        targetId: LearningId.from(TARGET_LEARNING_UUID),
        occurredAt: makeTimestamp(ANCHOR_TIME_MS + 100),
      });
      expect(() =>
        l.consolidateInto({
          targetId: LearningId.from(TARGET_LEARNING_UUID),
          occurredAt: makeTimestamp(ANCHOR_TIME_MS + 200),
        }),
      ).toThrow(LearningAlreadyConsolidatedError);
    });
  });

  describe("rehydrate", () => {
    it("rebuilds without emitting events", () => {
      const l = Learning.rehydrate({
        id: LearningId.from(FIXED_LEARNING_UUID),
        workspaceId: makeWorkspaceId(),
        text: LearningText.from("Use UTC for all timestamps"),
        severity: LearningSeverity.warning(),
        tags: makeTags(["time"]),
        confidence: makeConfidence(0.8),
        useCount: UseCount.of(3),
        lastUsed: LastUsed.at(makeTimestamp(ANCHOR_TIME_MS + 100)),
        scope: Scope.module("scheduler"),
        embeddingStatus: EmbeddingStatus.ready(),
        consolidatedInto: null,
        createdAt: makeTimestamp(),
        updatedAt: makeTimestamp(ANCHOR_TIME_MS + 100),
      });
      expect(l.pullEvents()).toHaveLength(0);
      expect(l.getUseCount().toNumber()).toBe(3);
      expect(l.getSeverity().isWarning()).toBe(true);
    });
  });

  describe("getters", () => {
    it("exposes all fields", () => {
      const l = makeLearning();
      expect(l.getWorkspaceId()).toBeDefined();
      expect(l.getText().toString()).toContain("canonicalise");
      expect(l.getSeverity().isTip()).toBe(true);
      expect(l.getTags().size()).toBe(2);
      expect(l.getConfidence().toNumber()).toBe(1);
      expect(l.getScope().isProject()).toBe(true);
      expect(l.getEmbeddingStatus().isPending()).toBe(true);
    });
  });
});
