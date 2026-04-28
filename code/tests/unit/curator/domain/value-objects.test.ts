/**
 * Bundled tests for small curator domain VOs (one VO per describe block).
 * Bundling keeps the file count manageable; each block is self-contained.
 */
import { describe, expect, it } from "vitest";
import { MemoryEntryKind } from "../../../../src/modules/curator/domain/value-objects/memory-entry-kind.ts";
import { ConsolidationThreshold } from "../../../../src/modules/curator/domain/value-objects/consolidation-threshold.ts";
import { PruneThreshold } from "../../../../src/modules/curator/domain/value-objects/prune-threshold.ts";
import { CosineScore as CuratorCosineScore } from "../../../../src/modules/curator/domain/value-objects/cosine-score.ts";
import { CuratorRunTrigger } from "../../../../src/modules/curator/domain/value-objects/curator-run-trigger.ts";
import { CuratorRunStats } from "../../../../src/modules/curator/domain/value-objects/curator-run-stats.ts";
import { CuratorRunId } from "../../../../src/modules/curator/domain/value-objects/curator-run-id.ts";
import { HealthFindingKind } from "../../../../src/modules/curator/domain/value-objects/health-finding-kind.ts";
import { HealthSeverity } from "../../../../src/modules/curator/domain/value-objects/health-severity.ts";
import { HealthFinding } from "../../../../src/modules/curator/domain/value-objects/health-finding.ts";
import { AffectedEntryRef } from "../../../../src/modules/curator/domain/value-objects/affected-entry-ref.ts";
import { PrunedReason } from "../../../../src/modules/curator/domain/value-objects/pruned-reason.ts";
import { PrunedEntry } from "../../../../src/modules/curator/domain/value-objects/pruned-entry.ts";
import { ConsolidationPair } from "../../../../src/modules/curator/domain/value-objects/consolidation-pair.ts";
import { PathStaleness } from "../../../../src/modules/curator/domain/value-objects/path-staleness.ts";
import { MaxEntriesPerKind } from "../../../../src/modules/curator/domain/value-objects/max-entries-per-kind.ts";
import { Confidence } from "../../../../src/shared/domain/value-objects/confidence.ts";
import { InvalidInputError } from "../../../../src/shared/domain/errors/invalid-input-error.ts";
import { InvalidConsolidationPairError } from "../../../../src/modules/curator/domain/errors/invalid-consolidation-pair-error.ts";
import {
  FIXED_CURATOR_RUN_UUID,
  FIXED_DECISION_UUID,
  FIXED_LEARNING_UUID,
  makeTimestamp,
  makeWorkspaceId,
} from "../../../helpers/factories.ts";

const SECOND_LEARNING_UUID = "01952f3c-2222-7000-8000-aaaaaaaaaaaa";

describe("MemoryEntryKind", () => {
  it("exposes factories for every kind", () => {
    expect(MemoryEntryKind.decision().isDecision()).toBe(true);
    expect(MemoryEntryKind.learning().isLearning()).toBe(true);
    expect(MemoryEntryKind.entity().isEntity()).toBe(true);
    expect(MemoryEntryKind.task().isTask()).toBe(true);
    expect(MemoryEntryKind.turn().isTurn()).toBe(true);
  });

  it("create accepts known strings", () => {
    expect(MemoryEntryKind.create("decision").toString()).toBe("decision");
    expect(MemoryEntryKind.create("  task  ").toString()).toBe("task");
  });

  it("create rejects unknown strings", () => {
    expect(() => MemoryEntryKind.create("session")).toThrow(InvalidInputError);
  });

  it("create rejects empty / whitespace-only", () => {
    expect(() => MemoryEntryKind.create("")).toThrow(InvalidInputError);
    expect(() => MemoryEntryKind.create("   ")).toThrow(InvalidInputError);
  });

  it("create rejects non-strings", () => {
    expect(() =>
      MemoryEntryKind.create(123 as unknown as string),
    ).toThrow(InvalidInputError);
  });

  it("isKind type guard", () => {
    expect(MemoryEntryKind.isKind("decision")).toBe(true);
    expect(MemoryEntryKind.isKind("nonsense")).toBe(false);
  });

  it("all returns the canonical catalog", () => {
    const all = MemoryEntryKind.all();
    expect(all).toContain("decision");
    expect(all).toContain("turn");
    expect(all.length).toBe(5);
  });

  it("equals compares by kind", () => {
    expect(MemoryEntryKind.task().equals(MemoryEntryKind.task())).toBe(true);
    expect(MemoryEntryKind.task().equals(MemoryEntryKind.entity())).toBe(false);
  });
});

describe("ConsolidationThreshold", () => {
  it("default is 0.92", () => {
    expect(ConsolidationThreshold.default().toNumber()).toBe(0.92);
  });

  it("of accepts [0, 1]", () => {
    expect(ConsolidationThreshold.of(0).toNumber()).toBe(0);
    expect(ConsolidationThreshold.of(1).toNumber()).toBe(1);
    expect(ConsolidationThreshold.of(0.5).toNumber()).toBe(0.5);
  });

  it("of rejects out-of-range / non-finite", () => {
    expect(() => ConsolidationThreshold.of(-0.1)).toThrow(InvalidInputError);
    expect(() => ConsolidationThreshold.of(1.1)).toThrow(InvalidInputError);
    expect(() => ConsolidationThreshold.of(Number.NaN)).toThrow(
      InvalidInputError,
    );
  });

  it("qualifies uses strict >", () => {
    const t = ConsolidationThreshold.of(0.92);
    expect(t.qualifies(0.95)).toBe(true);
    expect(t.qualifies(0.92)).toBe(false);
    expect(t.qualifies(0.5)).toBe(false);
  });

  it("qualifies returns false for non-finite", () => {
    expect(ConsolidationThreshold.default().qualifies(Number.NaN)).toBe(false);
  });

  it("equals compares by value", () => {
    expect(
      ConsolidationThreshold.of(0.5).equals(ConsolidationThreshold.of(0.5)),
    ).toBe(true);
  });
});

describe("PruneThreshold", () => {
  it("default is 0.1", () => {
    expect(PruneThreshold.default().toNumber()).toBe(0.1);
  });

  it("of rejects out-of-range / non-finite", () => {
    expect(() => PruneThreshold.of(-0.1)).toThrow(InvalidInputError);
    expect(() => PruneThreshold.of(1.5)).toThrow(InvalidInputError);
    expect(() => PruneThreshold.of(Number.POSITIVE_INFINITY)).toThrow(
      InvalidInputError,
    );
  });

  it("qualifies uses strict <", () => {
    const t = PruneThreshold.of(0.1);
    expect(t.qualifies(Confidence.of(0.05))).toBe(true);
    expect(t.qualifies(Confidence.of(0.1))).toBe(false);
    expect(t.qualifies(Confidence.of(0.5))).toBe(false);
  });

  it("equals compares by value", () => {
    expect(PruneThreshold.of(0.1).equals(PruneThreshold.of(0.1))).toBe(true);
    expect(PruneThreshold.of(0.1).equals(PruneThreshold.of(0.2))).toBe(false);
  });
});

describe("CosineScore (curator)", () => {
  it("of accepts [-1, 1]", () => {
    expect(CuratorCosineScore.of(-1).toNumber()).toBe(-1);
    expect(CuratorCosineScore.of(1).toNumber()).toBe(1);
  });

  it("of rejects out-of-range", () => {
    expect(() => CuratorCosineScore.of(1.1)).toThrow(InvalidInputError);
    expect(() => CuratorCosineScore.of(-1.1)).toThrow(InvalidInputError);
    expect(() => CuratorCosineScore.of(Number.NaN)).toThrow(InvalidInputError);
  });

  it("equals", () => {
    expect(CuratorCosineScore.of(0.5).equals(CuratorCosineScore.of(0.5))).toBe(true);
    expect(CuratorCosineScore.of(0.5).equals(CuratorCosineScore.of(0.6))).toBe(false);
  });
});

describe("CuratorRunTrigger", () => {
  it("factories return the right kind", () => {
    expect(CuratorRunTrigger.scheduled().isScheduled()).toBe(true);
    expect(CuratorRunTrigger.manual().isManual()).toBe(true);
    expect(CuratorRunTrigger.sessionClose().isSessionClose()).toBe(true);
  });

  it("create accepts known triggers", () => {
    expect(CuratorRunTrigger.create("scheduled").isScheduled()).toBe(true);
    expect(CuratorRunTrigger.create(" manual ").isManual()).toBe(true);
  });

  it("create rejects bad inputs", () => {
    expect(() => CuratorRunTrigger.create("")).toThrow(InvalidInputError);
    expect(() => CuratorRunTrigger.create("nope")).toThrow(InvalidInputError);
    expect(() => CuratorRunTrigger.create(123 as unknown as string)).toThrow(
      InvalidInputError,
    );
  });

  it("equals", () => {
    expect(
      CuratorRunTrigger.scheduled().equals(CuratorRunTrigger.scheduled()),
    ).toBe(true);
    expect(
      CuratorRunTrigger.scheduled().equals(CuratorRunTrigger.manual()),
    ).toBe(false);
  });
});

describe("CuratorRunStats", () => {
  it("empty has all zeros", () => {
    const s = CuratorRunStats.empty();
    expect(s.getEntriesScanned()).toBe(0);
    expect(s.getEntriesDecayed()).toBe(0);
    expect(s.getEntriesPruned()).toBe(0);
    expect(s.getLearningsConsolidated()).toBe(0);
    expect(s.getPathsCorrected()).toBe(0);
    expect(s.getEmbeddingsRequeued()).toBe(0);
    expect(s.getOpenQuestionsAged()).toBe(0);
    expect(s.getDurationMs()).toBe(0);
  });

  it("with overrides selected counters only", () => {
    const s = CuratorRunStats.empty().with({ entriesPruned: 7 });
    expect(s.getEntriesPruned()).toBe(7);
    expect(s.getEntriesScanned()).toBe(0);
  });

  it("of validates each counter", () => {
    expect(() =>
      CuratorRunStats.of({
        entriesScanned: -1,
        entriesDecayed: 0,
        entriesPruned: 0,
        learningsConsolidated: 0,
        pathsCorrected: 0,
        embeddingsRequeued: 0,
        openQuestionsAged: 0,
        durationMs: 0,
      }),
    ).toThrow(InvalidInputError);
    expect(() =>
      CuratorRunStats.of({
        entriesScanned: 0.5,
        entriesDecayed: 0,
        entriesPruned: 0,
        learningsConsolidated: 0,
        pathsCorrected: 0,
        embeddingsRequeued: 0,
        openQuestionsAged: 0,
        durationMs: 0,
      }),
    ).toThrow(InvalidInputError);
    expect(() =>
      CuratorRunStats.of({
        entriesScanned: Number.NaN,
        entriesDecayed: 0,
        entriesPruned: 0,
        learningsConsolidated: 0,
        pathsCorrected: 0,
        embeddingsRequeued: 0,
        openQuestionsAged: 0,
        durationMs: 0,
      }),
    ).toThrow(InvalidInputError);
  });

  it("equals", () => {
    const a = CuratorRunStats.empty().with({ entriesScanned: 5 });
    const b = CuratorRunStats.empty().with({ entriesScanned: 5 });
    expect(a.equals(b)).toBe(true);
    const c = CuratorRunStats.empty().with({ entriesScanned: 6 });
    expect(a.equals(c)).toBe(false);
  });

  it("toRecord returns frozen counters", () => {
    const r = CuratorRunStats.empty().toRecord();
    expect(Object.isFrozen(r)).toBe(true);
  });
});

describe("CuratorRunId", () => {
  it("from accepts a UUID v7", () => {
    const id = CuratorRunId.from(FIXED_CURATOR_RUN_UUID);
    expect(id.toString()).toBe(FIXED_CURATOR_RUN_UUID);
  });

  it("from rejects non-UUID", () => {
    expect(() => CuratorRunId.from("not-a-uuid")).toThrow(InvalidInputError);
  });
});

describe("HealthFindingKind / HealthSeverity", () => {
  it("HealthFindingKind factories", () => {
    expect(HealthFindingKind.pathStale().toString()).toBe("path_stale");
    expect(HealthFindingKind.decisionConflict().toString()).toBe(
      "decision_conflict",
    );
    expect(HealthFindingKind.embeddingDrift().toString()).toBe(
      "embedding_drift",
    );
    expect(HealthFindingKind.openQuestionAging().toString()).toBe(
      "open_question_aging",
    );
  });

  it("HealthFindingKind.create rejects unknown", () => {
    expect(() => HealthFindingKind.create("nope")).toThrow(InvalidInputError);
    expect(() => HealthFindingKind.create("")).toThrow(InvalidInputError);
    expect(() =>
      HealthFindingKind.create(123 as unknown as string),
    ).toThrow(InvalidInputError);
  });

  it("HealthSeverity rank ordering", () => {
    expect(HealthSeverity.error().isAtLeast(HealthSeverity.warning())).toBe(true);
    expect(HealthSeverity.info().isAtLeast(HealthSeverity.warning())).toBe(false);
    expect(HealthSeverity.error().isError()).toBe(true);
    expect(HealthSeverity.warning().isWarning()).toBe(true);
    expect(HealthSeverity.info().isInfo()).toBe(true);
  });

  it("HealthSeverity.create rejects unknown / empty", () => {
    expect(() => HealthSeverity.create("nope")).toThrow(InvalidInputError);
    expect(() => HealthSeverity.create("")).toThrow(InvalidInputError);
    expect(() =>
      HealthSeverity.create(undefined as unknown as string),
    ).toThrow(InvalidInputError);
  });
});

describe("HealthFinding", () => {
  const ref = AffectedEntryRef.of(MemoryEntryKind.entity(), FIXED_DECISION_UUID);

  it("create trims and validates description", () => {
    const f = HealthFinding.create({
      kind: HealthFindingKind.pathStale(),
      severity: HealthSeverity.info(),
      description: "  stale path  ",
      affectedEntries: [ref],
    });
    expect(f.description).toBe("stale path");
  });

  it("rejects empty description", () => {
    expect(() =>
      HealthFinding.create({
        kind: HealthFindingKind.pathStale(),
        severity: HealthSeverity.info(),
        description: "   ",
        affectedEntries: [],
      }),
    ).toThrow(InvalidInputError);
  });

  it("rejects too-long description", () => {
    expect(() =>
      HealthFinding.create({
        kind: HealthFindingKind.pathStale(),
        severity: HealthSeverity.info(),
        description: "x".repeat(2001),
        affectedEntries: [],
      }),
    ).toThrow(InvalidInputError);
  });

  it("rejects non-string description", () => {
    expect(() =>
      HealthFinding.create({
        kind: HealthFindingKind.pathStale(),
        severity: HealthSeverity.info(),
        description: 123 as unknown as string,
        affectedEntries: [],
      }),
    ).toThrow(InvalidInputError);
  });

  it("equals compares all fields", () => {
    const a = HealthFinding.create({
      kind: HealthFindingKind.pathStale(),
      severity: HealthSeverity.info(),
      description: "path stale",
      affectedEntries: [ref],
    });
    const b = HealthFinding.create({
      kind: HealthFindingKind.pathStale(),
      severity: HealthSeverity.info(),
      description: "path stale",
      affectedEntries: [ref],
    });
    expect(a.equals(b)).toBe(true);
    expect(a.equals(a)).toBe(true);
    const c = HealthFinding.create({
      kind: HealthFindingKind.pathStale(),
      severity: HealthSeverity.warning(),
      description: "path stale",
      affectedEntries: [ref],
    });
    expect(a.equals(c)).toBe(false);
  });
});

describe("AffectedEntryRef", () => {
  it("normalises uuid and stores", () => {
    const r = AffectedEntryRef.of(
      MemoryEntryKind.learning(),
      FIXED_LEARNING_UUID.toUpperCase(),
    );
    expect(r.id).toBe(FIXED_LEARNING_UUID);
    expect(r.kind.isLearning()).toBe(true);
  });

  it("rejects bad uuid", () => {
    expect(() =>
      AffectedEntryRef.of(MemoryEntryKind.learning(), "not-a-uuid"),
    ).toThrow(InvalidInputError);
  });

  it("equals compares kind + id", () => {
    const a = AffectedEntryRef.of(
      MemoryEntryKind.learning(),
      FIXED_LEARNING_UUID,
    );
    const b = AffectedEntryRef.of(
      MemoryEntryKind.learning(),
      FIXED_LEARNING_UUID,
    );
    expect(a.equals(b)).toBe(true);
    expect(a.equals(a)).toBe(true);
  });
});

describe("PrunedReason", () => {
  it("factories", () => {
    expect(PrunedReason.lowConfidence().toString()).toBe("low_confidence");
    expect(PrunedReason.manual().toString()).toBe("manual");
    expect(PrunedReason.consolidatedIntoOther().toString()).toBe(
      "consolidated_into_other",
    );
    expect(PrunedReason.obsoleted().toString()).toBe("obsoleted");
  });

  it("create rejects unknown / empty / non-string", () => {
    expect(() => PrunedReason.create("nope")).toThrow(InvalidInputError);
    expect(() => PrunedReason.create("")).toThrow(InvalidInputError);
    expect(() =>
      PrunedReason.create(null as unknown as string),
    ).toThrow(InvalidInputError);
  });
});

describe("PrunedEntry", () => {
  const base = {
    workspaceId: makeWorkspaceId(),
    kind: MemoryEntryKind.learning(),
    originalId: FIXED_LEARNING_UUID,
    contentSnapshot: "{}",
    reason: PrunedReason.lowConfidence(),
    prunedAt: makeTimestamp(),
  };

  it("create succeeds", () => {
    const p = PrunedEntry.create(base);
    expect(p.getKind().isLearning()).toBe(true);
    expect(p.getOriginalId()).toBe(FIXED_LEARNING_UUID);
  });

  it("rejects empty snapshot", () => {
    expect(() =>
      PrunedEntry.create({ ...base, contentSnapshot: "" }),
    ).toThrow(InvalidInputError);
  });

  it("rejects too-long snapshot", () => {
    expect(() =>
      PrunedEntry.create({
        ...base,
        contentSnapshot: "x".repeat(64 * 1024 + 1),
      }),
    ).toThrow(InvalidInputError);
  });

  it("rejects non-string snapshot", () => {
    expect(() =>
      PrunedEntry.create({
        ...base,
        contentSnapshot: null as unknown as string,
      }),
    ).toThrow(InvalidInputError);
  });

  it("equals compares all fields", () => {
    const p1 = PrunedEntry.create(base);
    const p2 = PrunedEntry.create(base);
    expect(p1.equals(p2)).toBe(true);
    expect(p1.equals(p1)).toBe(true);
  });
});

describe("ConsolidationPair", () => {
  const winner = AffectedEntryRef.of(
    MemoryEntryKind.learning(),
    FIXED_LEARNING_UUID,
  );
  const loser = AffectedEntryRef.of(
    MemoryEntryKind.learning(),
    SECOND_LEARNING_UUID,
  );

  it("of constructs a valid pair", () => {
    const pair = ConsolidationPair.of({
      winner,
      loser,
      cosineScore: CuratorCosineScore.of(0.95),
    });
    expect(pair.winner.equals(winner)).toBe(true);
    expect(pair.loser.equals(loser)).toBe(true);
  });

  it("rejects self-pair", () => {
    expect(() =>
      ConsolidationPair.of({
        winner,
        loser: winner,
        cosineScore: CuratorCosineScore.of(0.95),
      }),
    ).toThrow(InvalidConsolidationPairError);
  });

  it("rejects cross-kind", () => {
    const learningRef = AffectedEntryRef.of(
      MemoryEntryKind.learning(),
      FIXED_LEARNING_UUID,
    );
    const decisionRef = AffectedEntryRef.of(
      MemoryEntryKind.decision(),
      SECOND_LEARNING_UUID,
    );
    expect(() =>
      ConsolidationPair.of({
        winner: learningRef,
        loser: decisionRef,
        cosineScore: CuratorCosineScore.of(0.95),
      }),
    ).toThrow(InvalidConsolidationPairError);
  });

  it("equals", () => {
    const a = ConsolidationPair.of({
      winner,
      loser,
      cosineScore: CuratorCosineScore.of(0.95),
    });
    const b = ConsolidationPair.of({
      winner,
      loser,
      cosineScore: CuratorCosineScore.of(0.95),
    });
    expect(a.equals(b)).toBe(true);
    expect(a.equals(a)).toBe(true);
  });
});

describe("PathStaleness", () => {
  it("factories", () => {
    expect(PathStaleness.present("/x").isPresent()).toBe(true);
    expect(PathStaleness.missing("/x").isMissing()).toBe(true);
    expect(PathStaleness.unresolvable("/x").isUnresolvable()).toBe(true);
  });

  it("requiresAttention", () => {
    expect(PathStaleness.present("/x").requiresAttention()).toBe(false);
    expect(PathStaleness.missing("/x").requiresAttention()).toBe(true);
    expect(PathStaleness.unresolvable("/x").requiresAttention()).toBe(true);
  });

  it("rejects empty / non-string path", () => {
    expect(() => PathStaleness.present("")).toThrow(InvalidInputError);
    expect(() =>
      PathStaleness.missing(undefined as unknown as string),
    ).toThrow(InvalidInputError);
  });

  it("isKind type guard", () => {
    expect(PathStaleness.isKind("present")).toBe(true);
    expect(PathStaleness.isKind("nope")).toBe(false);
  });

  it("equals", () => {
    expect(
      PathStaleness.present("/a").equals(PathStaleness.present("/a")),
    ).toBe(true);
    expect(
      PathStaleness.present("/a").equals(PathStaleness.missing("/a")),
    ).toBe(false);
    expect(
      PathStaleness.present("/a").equals(PathStaleness.present("/b")),
    ).toBe(false);
  });
});

describe("MaxEntriesPerKind", () => {
  it("default fills every kind", () => {
    const caps = MaxEntriesPerKind.default();
    expect(caps.forKind(MemoryEntryKind.decision())).toBe(5000);
    expect(caps.forKind(MemoryEntryKind.task())).toBe(5000);
  });

  it("of overrides selected kinds", () => {
    const caps = MaxEntriesPerKind.of({ task: 100 });
    expect(caps.forKind(MemoryEntryKind.task())).toBe(100);
    expect(caps.forKind(MemoryEntryKind.decision())).toBe(5000);
  });

  it("rejects non-positive cap", () => {
    expect(() => MaxEntriesPerKind.of({ task: 0 })).toThrow(InvalidInputError);
    expect(() => MaxEntriesPerKind.of({ task: -1 })).toThrow(InvalidInputError);
  });

  it("rejects fractional cap", () => {
    expect(() => MaxEntriesPerKind.of({ task: 1.5 })).toThrow(InvalidInputError);
  });

  it("rejects non-finite cap", () => {
    expect(() =>
      MaxEntriesPerKind.of({ task: Number.POSITIVE_INFINITY }),
    ).toThrow(InvalidInputError);
  });

  it("toRecord is frozen", () => {
    const r = MaxEntriesPerKind.default().toRecord();
    expect(Object.isFrozen(r)).toBe(true);
  });

  it("equals", () => {
    expect(
      MaxEntriesPerKind.default().equals(MaxEntriesPerKind.default()),
    ).toBe(true);
    expect(
      MaxEntriesPerKind.default().equals(MaxEntriesPerKind.of({ task: 1 })),
    ).toBe(false);
  });
});
