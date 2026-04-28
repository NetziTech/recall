import { describe, expect, it } from "vitest";
import { CuratorRun } from "../../../../src/modules/curator/domain/aggregates/curator-run.ts";
import { CuratorRunId } from "../../../../src/modules/curator/domain/value-objects/curator-run-id.ts";
import { CuratorRunTrigger } from "../../../../src/modules/curator/domain/value-objects/curator-run-trigger.ts";
import { CuratorRunStats } from "../../../../src/modules/curator/domain/value-objects/curator-run-stats.ts";
import { HealthFinding } from "../../../../src/modules/curator/domain/value-objects/health-finding.ts";
import { HealthFindingKind } from "../../../../src/modules/curator/domain/value-objects/health-finding-kind.ts";
import { HealthSeverity } from "../../../../src/modules/curator/domain/value-objects/health-severity.ts";
import { ConsolidationPair } from "../../../../src/modules/curator/domain/value-objects/consolidation-pair.ts";
import { CosineScore } from "../../../../src/modules/curator/domain/value-objects/cosine-score.ts";
import { AffectedEntryRef } from "../../../../src/modules/curator/domain/value-objects/affected-entry-ref.ts";
import { MemoryEntryKind } from "../../../../src/modules/curator/domain/value-objects/memory-entry-kind.ts";
import { PrunedReason } from "../../../../src/modules/curator/domain/value-objects/pruned-reason.ts";
import { CuratorRunStarted } from "../../../../src/modules/curator/domain/events/curator-run-started.ts";
import { CuratorRunCompleted } from "../../../../src/modules/curator/domain/events/curator-run-completed.ts";
import { HealthFindingDetected } from "../../../../src/modules/curator/domain/events/health-finding-detected.ts";
import { LearningsConsolidated } from "../../../../src/modules/curator/domain/events/learnings-consolidated.ts";
import { EntryPruned } from "../../../../src/modules/curator/domain/events/entry-pruned.ts";
import { CuratorRunAlreadyCompletedError } from "../../../../src/modules/curator/domain/errors/curator-run-already-completed-error.ts";
import { InvariantViolationError } from "../../../../src/shared/domain/errors/invariant-violation-error.ts";
import {
  ANCHOR_TIME_MS,
  FIXED_CURATOR_RUN_UUID,
  FIXED_LEARNING_UUID,
  FIXED_DECISION_UUID,
  makeTimestamp,
  makeWorkspaceId,
} from "../../../helpers/factories.ts";

const SECOND_LEARNING_UUID = "01952f3c-2222-7000-8000-aaaaaaaaaaaa";

function makeRun(): CuratorRun {
  return CuratorRun.start({
    id: CuratorRunId.from(FIXED_CURATOR_RUN_UUID),
    workspaceId: makeWorkspaceId(),
    trigger: CuratorRunTrigger.scheduled(),
    occurredAt: makeTimestamp(),
  });
}

function makeFinding(): HealthFinding {
  return HealthFinding.create({
    kind: HealthFindingKind.pathStale(),
    severity: HealthSeverity.info(),
    description: "path '/old.ts' no longer exists",
    affectedEntries: [
      AffectedEntryRef.of(MemoryEntryKind.entity(), FIXED_DECISION_UUID),
    ],
  });
}

function makePair(): ConsolidationPair {
  return ConsolidationPair.of({
    winner: AffectedEntryRef.of(
      MemoryEntryKind.learning(),
      FIXED_LEARNING_UUID,
    ),
    loser: AffectedEntryRef.of(
      MemoryEntryKind.learning(),
      SECOND_LEARNING_UUID,
    ),
    cosineScore: CosineScore.of(0.95),
  });
}

describe("CuratorRun (aggregate)", () => {
  describe("start", () => {
    it("creates a running aggregate with empty stats", () => {
      const r = makeRun();
      expect(r.isRunning()).toBe(true);
      expect(r.isCompleted()).toBe(false);
      expect(r.getEndedAt()).toBe(null);
      expect(r.getStats().getEntriesScanned()).toBe(0);
      expect(r.getFindings()).toHaveLength(0);
      expect(r.getConsolidations()).toHaveLength(0);
    });

    it("emits CuratorRunStarted", () => {
      const r = makeRun();
      const events = r.pullEvents();
      expect(events.length).toBe(1);
      expect(events[0]).toBeInstanceOf(CuratorRunStarted);
    });

    it("supports manual trigger", () => {
      const r = CuratorRun.start({
        id: CuratorRunId.from(FIXED_CURATOR_RUN_UUID),
        workspaceId: makeWorkspaceId(),
        trigger: CuratorRunTrigger.manual(),
        occurredAt: makeTimestamp(),
      });
      expect(r.getTrigger().isManual()).toBe(true);
    });
  });

  describe("recordFinding", () => {
    it("appends a finding and emits HealthFindingDetected", () => {
      const r = makeRun();
      r.pullEvents();
      r.recordFinding({
        finding: makeFinding(),
        occurredAt: makeTimestamp(ANCHOR_TIME_MS + 100),
      });
      expect(r.getFindings()).toHaveLength(1);
      const events = r.pullEvents();
      expect(events.length).toBe(1);
      expect(events[0]).toBeInstanceOf(HealthFindingDetected);
    });

    it("refuses on a completed run", () => {
      const r = makeRun();
      r.complete({
        finalStats: CuratorRunStats.empty(),
        occurredAt: makeTimestamp(ANCHOR_TIME_MS + 100),
      });
      expect(() =>
        r.recordFinding({
          finding: makeFinding(),
          occurredAt: makeTimestamp(ANCHOR_TIME_MS + 200),
        }),
      ).toThrow(CuratorRunAlreadyCompletedError);
    });

    it("returned snapshot is frozen (mutation has no effect)", () => {
      const r = makeRun();
      r.recordFinding({
        finding: makeFinding(),
        occurredAt: makeTimestamp(ANCHOR_TIME_MS + 100),
      });
      const snapshot = r.getFindings();
      expect(Object.isFrozen(snapshot)).toBe(true);
    });
  });

  describe("recordConsolidation", () => {
    it("appends a pair and emits LearningsConsolidated", () => {
      const r = makeRun();
      r.pullEvents();
      r.recordConsolidation({
        pair: makePair(),
        occurredAt: makeTimestamp(ANCHOR_TIME_MS + 100),
      });
      expect(r.getConsolidations()).toHaveLength(1);
      const events = r.pullEvents();
      expect(events.length).toBe(1);
      expect(events[0]).toBeInstanceOf(LearningsConsolidated);
    });

    it("refuses on a completed run", () => {
      const r = makeRun();
      r.complete({
        finalStats: CuratorRunStats.empty(),
        occurredAt: makeTimestamp(ANCHOR_TIME_MS + 100),
      });
      expect(() =>
        r.recordConsolidation({
          pair: makePair(),
          occurredAt: makeTimestamp(ANCHOR_TIME_MS + 200),
        }),
      ).toThrow(CuratorRunAlreadyCompletedError);
    });
  });

  describe("recordPrune", () => {
    it("emits EntryPruned", () => {
      const r = makeRun();
      r.pullEvents();
      r.recordPrune({
        kind: MemoryEntryKind.learning(),
        originalId: FIXED_LEARNING_UUID,
        reason: PrunedReason.lowConfidence(),
        occurredAt: makeTimestamp(ANCHOR_TIME_MS + 100),
      });
      const events = r.pullEvents();
      expect(events.length).toBe(1);
      expect(events[0]).toBeInstanceOf(EntryPruned);
    });

    it("refuses on a completed run", () => {
      const r = makeRun();
      r.complete({
        finalStats: CuratorRunStats.empty(),
        occurredAt: makeTimestamp(ANCHOR_TIME_MS + 100),
      });
      expect(() =>
        r.recordPrune({
          kind: MemoryEntryKind.learning(),
          originalId: FIXED_LEARNING_UUID,
          reason: PrunedReason.manual(),
          occurredAt: makeTimestamp(ANCHOR_TIME_MS + 200),
        }),
      ).toThrow(CuratorRunAlreadyCompletedError);
    });
  });

  describe("complete", () => {
    it("marks the run as completed and emits CuratorRunCompleted", () => {
      const r = makeRun();
      r.pullEvents();
      const finalStats = CuratorRunStats.empty().with({
        entriesScanned: 100,
        durationMs: 50,
      });
      r.complete({
        finalStats,
        occurredAt: makeTimestamp(ANCHOR_TIME_MS + 1000),
      });
      expect(r.isCompleted()).toBe(true);
      expect(r.getEndedAt()).not.toBe(null);
      expect(r.getStats().getEntriesScanned()).toBe(100);
      const events = r.pullEvents();
      expect(events.length).toBe(1);
      expect(events[0]).toBeInstanceOf(CuratorRunCompleted);
    });

    it("rejects re-completion", () => {
      const r = makeRun();
      r.complete({
        finalStats: CuratorRunStats.empty(),
        occurredAt: makeTimestamp(ANCHOR_TIME_MS + 100),
      });
      expect(() =>
        r.complete({
          finalStats: CuratorRunStats.empty(),
          occurredAt: makeTimestamp(ANCHOR_TIME_MS + 200),
        }),
      ).toThrow(CuratorRunAlreadyCompletedError);
    });

    it("rejects completion before start", () => {
      const r = makeRun();
      expect(() =>
        r.complete({
          finalStats: CuratorRunStats.empty(),
          occurredAt: makeTimestamp(ANCHOR_TIME_MS - 1),
        }),
      ).toThrow(InvariantViolationError);
    });
  });

  describe("rehydrate", () => {
    it("rebuilds without emitting events", () => {
      const r = CuratorRun.rehydrate({
        id: CuratorRunId.from(FIXED_CURATOR_RUN_UUID),
        workspaceId: makeWorkspaceId(),
        trigger: CuratorRunTrigger.scheduled(),
        startedAt: makeTimestamp(),
        endedAt: makeTimestamp(ANCHOR_TIME_MS + 1000),
        stats: CuratorRunStats.empty(),
        findings: [],
        consolidations: [],
      });
      expect(r.pullEvents()).toHaveLength(0);
      expect(r.isCompleted()).toBe(true);
    });

    it("rejects endedAt before startedAt", () => {
      expect(() =>
        CuratorRun.rehydrate({
          id: CuratorRunId.from(FIXED_CURATOR_RUN_UUID),
          workspaceId: makeWorkspaceId(),
          trigger: CuratorRunTrigger.scheduled(),
          startedAt: makeTimestamp(ANCHOR_TIME_MS + 1000),
          endedAt: makeTimestamp(ANCHOR_TIME_MS),
          stats: CuratorRunStats.empty(),
          findings: [],
          consolidations: [],
        }),
      ).toThrow(InvariantViolationError);
    });
  });

  describe("getters", () => {
    it("exposes basic fields", () => {
      const r = makeRun();
      expect(r.getId().toString()).toBe(FIXED_CURATOR_RUN_UUID);
      expect(r.getWorkspaceId()).toBeDefined();
      expect(r.getTrigger().isScheduled()).toBe(true);
      expect(r.getStartedAt().toEpochMs()).toBe(ANCHOR_TIME_MS);
    });
  });
});
