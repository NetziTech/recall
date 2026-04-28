import { describe, expect, it } from "vitest";
import { Decision } from "../../../../src/modules/memory/domain/aggregates/decision.ts";
import { DecisionId } from "../../../../src/modules/memory/domain/value-objects/decision-id.ts";
import { DecisionStatus } from "../../../../src/modules/memory/domain/value-objects/decision-status.ts";
import { DecisionTitle } from "../../../../src/modules/memory/domain/value-objects/decision-title.ts";
import { Rationale } from "../../../../src/modules/memory/domain/value-objects/rationale.ts";
import { Scope } from "../../../../src/modules/memory/domain/value-objects/scope.ts";
import { EmbeddingStatus } from "../../../../src/modules/memory/domain/value-objects/embedding-status.ts";
import { SupersededBy } from "../../../../src/modules/memory/domain/value-objects/superseded-by.ts";
import { LastUsed } from "../../../../src/modules/memory/domain/value-objects/last-used.ts";
import { UseCount } from "../../../../src/modules/memory/domain/value-objects/use-count.ts";
import { SessionId } from "../../../../src/modules/memory/domain/value-objects/session-id.ts";
import { DecisionSelfSupersessionError } from "../../../../src/modules/memory/domain/errors/decision-self-supersession-error.ts";
import { DecisionNotActiveError } from "../../../../src/modules/memory/domain/errors/decision-not-active-error.ts";
import { DecisionRecorded } from "../../../../src/modules/memory/domain/events/decision-recorded.ts";
import { DecisionSuperseded } from "../../../../src/modules/memory/domain/events/decision-superseded.ts";
import { DecisionUsed } from "../../../../src/modules/memory/domain/events/decision-used.ts";
import {
  ANCHOR_TIME_MS,
  FIXED_DECISION_UUID,
  FIXED_SESSION_UUID,
  makeConfidence,
  makeTags,
  makeTimestamp,
  makeWorkspaceId,
} from "../../../helpers/factories.ts";

const SUCCESSOR_UUID = "01952f3b-7d8c-7000-8000-cccccccccccc";

function makeDecision(): Decision {
  return Decision.record({
    id: DecisionId.from(FIXED_DECISION_UUID),
    workspaceId: makeWorkspaceId(),
    sessionId: SessionId.from(FIXED_SESSION_UUID),
    title: DecisionTitle.from("Use SQLCipher"),
    rationale: Rationale.from("Encryption at rest"),
    tags: makeTags(["security", "db"]),
    confidence: makeConfidence(),
    scope: Scope.project(),
    embeddingStatus: EmbeddingStatus.pending(),
    occurredAt: makeTimestamp(),
  });
}

describe("Decision (aggregate)", () => {
  describe("record (factory)", () => {
    it("creates an active decision with defaults", () => {
      const d = makeDecision();
      expect(d.getId().toString()).toBe(FIXED_DECISION_UUID);
      expect(d.isActive()).toBe(true);
      expect(d.getStatus().isActive()).toBe(true);
      expect(d.getSupersededBy()).toBe(null);
      expect(d.getUseCount().toNumber()).toBe(0);
      expect(d.getLastUsed().hasBeenUsed()).toBe(false);
      expect(d.getCreatedAt().equals(d.getUpdatedAt())).toBe(true);
    });

    it("emits a DecisionRecorded event on record", () => {
      const d = makeDecision();
      const events = d.pullEvents();
      expect(events.length).toBe(1);
      expect(events[0]).toBeInstanceOf(DecisionRecorded);
    });

    it("supports null sessionId", () => {
      const d = Decision.record({
        id: DecisionId.from(FIXED_DECISION_UUID),
        workspaceId: makeWorkspaceId(),
        sessionId: null,
        title: DecisionTitle.from("Out-of-band decision"),
        rationale: Rationale.from("CLI import"),
        tags: makeTags(),
        confidence: makeConfidence(),
        scope: Scope.project(),
        embeddingStatus: EmbeddingStatus.pending(),
        occurredAt: makeTimestamp(),
      });
      expect(d.getSessionId()).toBe(null);
    });
  });

  describe("supersede", () => {
    it("transitions an active decision to superseded", () => {
      const d = makeDecision();
      d.pullEvents();
      const successor = DecisionId.from(SUCCESSOR_UUID);
      const after = makeTimestamp(ANCHOR_TIME_MS + 1000);
      d.supersede({ successorId: successor, occurredAt: after });
      expect(d.getStatus().isSuperseded()).toBe(true);
      expect(d.isActive()).toBe(false);
      expect(d.getSupersededBy()?.equals(SupersededBy.of(successor))).toBe(true);
      expect(d.getUpdatedAt().equals(after)).toBe(true);
    });

    it("emits a DecisionSuperseded event", () => {
      const d = makeDecision();
      d.pullEvents();
      d.supersede({
        successorId: DecisionId.from(SUCCESSOR_UUID),
        occurredAt: makeTimestamp(ANCHOR_TIME_MS + 1),
      });
      const events = d.pullEvents();
      expect(events.length).toBe(1);
      expect(events[0]).toBeInstanceOf(DecisionSuperseded);
    });

    it("rejects self-supersession", () => {
      const d = makeDecision();
      expect(() =>
        d.supersede({
          successorId: DecisionId.from(FIXED_DECISION_UUID),
          occurredAt: makeTimestamp(ANCHOR_TIME_MS + 1),
        }),
      ).toThrow(DecisionSelfSupersessionError);
    });

    it("rejects re-supersession (already superseded)", () => {
      const d = makeDecision();
      d.supersede({
        successorId: DecisionId.from(SUCCESSOR_UUID),
        occurredAt: makeTimestamp(ANCHOR_TIME_MS + 1),
      });
      expect(() =>
        d.supersede({
          successorId: DecisionId.from(SUCCESSOR_UUID),
          occurredAt: makeTimestamp(ANCHOR_TIME_MS + 2),
        }),
      ).toThrow(DecisionNotActiveError);
    });
  });

  describe("markUsed", () => {
    it("increments useCount and updates lastUsed", () => {
      const d = makeDecision();
      const before = d.getUseCount().toNumber();
      d.markUsed({ occurredAt: makeTimestamp(ANCHOR_TIME_MS + 100) });
      expect(d.getUseCount().toNumber()).toBe(before + 1);
      expect(d.getLastUsed().hasBeenUsed()).toBe(true);
    });

    it("emits a DecisionUsed event", () => {
      const d = makeDecision();
      d.pullEvents();
      d.markUsed({ occurredAt: makeTimestamp(ANCHOR_TIME_MS + 100) });
      const events = d.pullEvents();
      expect(events.length).toBe(1);
      expect(events[0]).toBeInstanceOf(DecisionUsed);
    });

    it("can mark a superseded decision as used (audit trail)", () => {
      const d = makeDecision();
      d.supersede({
        successorId: DecisionId.from(SUCCESSOR_UUID),
        occurredAt: makeTimestamp(ANCHOR_TIME_MS + 1),
      });
      d.markUsed({ occurredAt: makeTimestamp(ANCHOR_TIME_MS + 2) });
      expect(d.getUseCount().toNumber()).toBe(1);
    });
  });

  describe("rehydrate", () => {
    it("does not emit any event when rehydrating", () => {
      const d = Decision.rehydrate({
        id: DecisionId.from(FIXED_DECISION_UUID),
        workspaceId: makeWorkspaceId(),
        sessionId: null,
        title: DecisionTitle.from("Use SQLCipher"),
        rationale: Rationale.from("Encryption"),
        tags: makeTags(),
        status: DecisionStatus.active(),
        supersededBy: null,
        confidence: makeConfidence(),
        useCount: UseCount.of(5),
        lastUsed: LastUsed.at(makeTimestamp(ANCHOR_TIME_MS + 100)),
        scope: Scope.module("auth"),
        embeddingStatus: EmbeddingStatus.ready(),
        createdAt: makeTimestamp(),
        updatedAt: makeTimestamp(ANCHOR_TIME_MS + 50),
      });
      expect(d.pullEvents()).toHaveLength(0);
      expect(d.getUseCount().toNumber()).toBe(5);
      expect(d.getEmbeddingStatus().isReady()).toBe(true);
    });
  });

  describe("pullEvents", () => {
    it("drains events idempotently", () => {
      const d = makeDecision();
      const first = d.pullEvents();
      const second = d.pullEvents();
      expect(first.length).toBe(1);
      expect(second.length).toBe(0);
    });
  });

  describe("getters", () => {
    it("exposes all aggregate fields", () => {
      const d = makeDecision();
      expect(d.getWorkspaceId()).toBeDefined();
      expect(d.getSessionId()).toBeDefined();
      expect(d.getTitle().toString()).toBe("Use SQLCipher");
      expect(d.getRationale().toString()).toBe("Encryption at rest");
      expect(d.getTags().size()).toBe(2);
      expect(d.getConfidence().toNumber()).toBe(1);
      expect(d.getScope().isProject()).toBe(true);
      expect(d.getEmbeddingStatus().isPending()).toBe(true);
    });
  });
});
