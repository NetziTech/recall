import { describe, expect, it } from "vitest";
import { Turn } from "../../../../src/modules/memory/domain/aggregates/turn.ts";
import { TurnId } from "../../../../src/modules/memory/domain/value-objects/turn-id.ts";
import { SessionId } from "../../../../src/modules/memory/domain/value-objects/session-id.ts";
import { TurnSummary } from "../../../../src/modules/memory/domain/value-objects/turn-summary.ts";
import { TurnIntent } from "../../../../src/modules/memory/domain/value-objects/turn-intent.ts";
import { TurnOutcome } from "../../../../src/modules/memory/domain/value-objects/turn-outcome.ts";
import { FilesTouched } from "../../../../src/modules/memory/domain/value-objects/files-touched.ts";
import { LinkedDecisionIds } from "../../../../src/modules/memory/domain/value-objects/linked-decision-ids.ts";
import { LinkedLearningIds } from "../../../../src/modules/memory/domain/value-objects/linked-learning-ids.ts";
import { Confidence } from "../../../../src/shared/domain/value-objects/confidence.ts";
import { LastUsed } from "../../../../src/modules/memory/domain/value-objects/last-used.ts";
import { UseCount } from "../../../../src/modules/memory/domain/value-objects/use-count.ts";
import { TurnRecorded } from "../../../../src/modules/memory/domain/events/turn-recorded.ts";
import { TurnUsed } from "../../../../src/modules/memory/domain/events/turn-used.ts";
import {
  ANCHOR_TIME_MS,
  FIXED_SESSION_UUID,
  FIXED_TURN_UUID,
  makeTags,
  makeTimestamp,
  makeWorkspaceId,
} from "../../../helpers/factories.ts";

function buildTurn(): Turn {
  return Turn.record({
    id: TurnId.from(FIXED_TURN_UUID),
    workspaceId: makeWorkspaceId(),
    sessionId: SessionId.from(FIXED_SESSION_UUID),
    summary: TurnSummary.from("did the work"),
    intent: TurnIntent.from("intent"),
    outcome: TurnOutcome.from("outcome"),
    filesTouched: FilesTouched.create(["a.ts"]),
    linkedDecisions: LinkedDecisionIds.empty(),
    linkedLearnings: LinkedLearningIds.empty(),
    tags: makeTags(["x"]),
    confidence: Confidence.full(),
    occurredAt: makeTimestamp(),
  });
}

describe("Turn (aggregate)", () => {
  describe("record", () => {
    it("constructs with zero useCount, never lastUsed, and emits TurnRecorded", () => {
      const t = buildTurn();
      expect(t.getUseCount().toNumber()).toBe(0);
      expect(t.getLastUsed().hasBeenUsed()).toBe(false);
      const events = t.pullEvents();
      expect(events.length).toBe(1);
      expect(events[0]).toBeInstanceOf(TurnRecorded);
    });

    it("preserves the supplied identifiers and metadata", () => {
      const t = buildTurn();
      expect(t.getId().toString()).toBe(FIXED_TURN_UUID);
      expect(t.getSessionId().toString()).toBe(FIXED_SESSION_UUID);
      expect(t.getSummary().toString()).toBe("did the work");
      expect(t.getIntent()?.toString()).toBe("intent");
      expect(t.getOutcome()?.toString()).toBe("outcome");
      expect(t.getFilesTouched().size()).toBe(1);
      expect(t.getCreatedAt().toEpochMs()).toBe(ANCHOR_TIME_MS);
    });

    it("accepts null intent / null outcome", () => {
      const t = Turn.record({
        id: TurnId.from(FIXED_TURN_UUID),
        workspaceId: makeWorkspaceId(),
        sessionId: SessionId.from(FIXED_SESSION_UUID),
        summary: TurnSummary.from("s"),
        intent: null,
        outcome: null,
        filesTouched: FilesTouched.empty(),
        linkedDecisions: LinkedDecisionIds.empty(),
        linkedLearnings: LinkedLearningIds.empty(),
        tags: makeTags(),
        confidence: Confidence.full(),
        occurredAt: makeTimestamp(),
      });
      expect(t.getIntent()).toBe(null);
      expect(t.getOutcome()).toBe(null);
    });
  });

  describe("markUsed", () => {
    it("increments useCount, refreshes lastUsed, emits TurnUsed", () => {
      const t = buildTurn();
      t.pullEvents();
      t.markUsed({ occurredAt: makeTimestamp(ANCHOR_TIME_MS + 1000) });
      expect(t.getUseCount().toNumber()).toBe(1);
      expect(t.getLastUsed().hasBeenUsed()).toBe(true);
      const events = t.pullEvents();
      expect(events[0]).toBeInstanceOf(TurnUsed);
    });

    it("multiple markUsed calls accumulate counters", () => {
      const t = buildTurn();
      t.pullEvents();
      t.markUsed({ occurredAt: makeTimestamp(ANCHOR_TIME_MS + 1) });
      t.markUsed({ occurredAt: makeTimestamp(ANCHOR_TIME_MS + 2) });
      expect(t.getUseCount().toNumber()).toBe(2);
    });
  });

  describe("rehydrate", () => {
    it("rebuilds without emitting events", () => {
      const t = Turn.rehydrate({
        id: TurnId.from(FIXED_TURN_UUID),
        workspaceId: makeWorkspaceId(),
        sessionId: SessionId.from(FIXED_SESSION_UUID),
        summary: TurnSummary.from("s"),
        intent: null,
        outcome: null,
        filesTouched: FilesTouched.empty(),
        linkedDecisions: LinkedDecisionIds.empty(),
        linkedLearnings: LinkedLearningIds.empty(),
        tags: makeTags(),
        confidence: Confidence.full(),
        useCount: UseCount.of(3),
        lastUsed: LastUsed.at(makeTimestamp(ANCHOR_TIME_MS + 100)),
        createdAt: makeTimestamp(ANCHOR_TIME_MS),
      });
      expect(t.pullEvents().length).toBe(0);
      expect(t.getUseCount().toNumber()).toBe(3);
      expect(t.getLastUsed().hasBeenUsed()).toBe(true);
    });
  });

  describe("query getters", () => {
    it("expose every persisted field", () => {
      const t = buildTurn();
      expect(t.getWorkspaceId().toString()).toBeDefined();
      expect(t.getTags().toArray()).toContain("x");
      expect(t.getConfidence().toNumber()).toBe(1);
      expect(t.getLinkedDecisions().size()).toBe(0);
      expect(t.getLinkedLearnings().size()).toBe(0);
    });
  });
});
