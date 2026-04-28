import { describe, expect, it } from "vitest";
import { QueryText } from "../../../../src/modules/retrieval/domain/value-objects/query-text.ts";
import { QueryKind } from "../../../../src/modules/retrieval/domain/value-objects/query-kind.ts";
import { Query } from "../../../../src/modules/retrieval/domain/value-objects/query.ts";
import { TokenBudget } from "../../../../src/modules/retrieval/domain/value-objects/token-budget.ts";
import { RecallFilters } from "../../../../src/modules/retrieval/domain/value-objects/recall-filters.ts";
import { ContextLayerKind } from "../../../../src/modules/retrieval/domain/value-objects/context-layer-kind.ts";
import { BM25Score } from "../../../../src/modules/retrieval/domain/value-objects/bm25-score.ts";
import { CosineScore } from "../../../../src/modules/retrieval/domain/value-objects/cosine-score.ts";
import { RecencyScore } from "../../../../src/modules/retrieval/domain/value-objects/recency-score.ts";
import { UsageScore } from "../../../../src/modules/retrieval/domain/value-objects/usage-score.ts";
import { PriorityBoost } from "../../../../src/modules/retrieval/domain/value-objects/priority-boost.ts";
import { RelevanceScore } from "../../../../src/modules/retrieval/domain/value-objects/relevance-score.ts";
import { RelevanceWeights } from "../../../../src/modules/retrieval/domain/value-objects/relevance-weights.ts";
import { LastUsed } from "../../../../src/modules/memory/domain/value-objects/last-used.ts";
import { UseCount } from "../../../../src/modules/memory/domain/value-objects/use-count.ts";
import { Tokens } from "../../../../src/shared/domain/value-objects/tokens.ts";
import { Confidence } from "../../../../src/shared/domain/value-objects/confidence.ts";
import { Tags } from "../../../../src/shared/domain/value-objects/tags.ts";
import { InvalidQueryError } from "../../../../src/modules/retrieval/domain/errors/invalid-query-error.ts";
import { InvalidRecallFiltersError } from "../../../../src/modules/retrieval/domain/errors/invalid-recall-filters-error.ts";
import { InvalidInputError } from "../../../../src/shared/domain/errors/invalid-input-error.ts";
import { TokenBudgetExceededError } from "../../../../src/modules/retrieval/domain/errors/token-budget-exceeded-error.ts";
import { ANCHOR_TIME_MS, makeTimestamp } from "../../../helpers/factories.ts";

describe("QueryText", () => {
  it("trims and accepts non-empty", () => {
    const t = QueryText.create("  hello  ");
    expect(t.toString()).toBe("hello");
    expect(t.length()).toBe(5);
  });

  it("rejects empty / whitespace-only", () => {
    expect(() => QueryText.create("")).toThrow(InvalidQueryError);
    expect(() => QueryText.create("   ")).toThrow(InvalidQueryError);
  });

  it("rejects too-long (>5000 chars)", () => {
    expect(() => QueryText.create("x".repeat(5001))).toThrow(InvalidQueryError);
  });

  it("rejects non-string", () => {
    expect(() =>
      QueryText.create(123 as unknown as string),
    ).toThrow(InvalidQueryError);
  });

  it("equals (case-sensitive)", () => {
    expect(QueryText.create("Foo").equals(QueryText.create("Foo"))).toBe(true);
    expect(QueryText.create("Foo").equals(QueryText.create("foo"))).toBe(false);
  });
});

describe("QueryKind", () => {
  it("factories", () => {
    expect(QueryKind.decision().value).toBe("decision");
    expect(QueryKind.learning().value).toBe("learning");
    expect(QueryKind.entity().value).toBe("entity");
    expect(QueryKind.task().value).toBe("task");
    expect(QueryKind.turn().value).toBe("turn");
  });

  it("create accepts canonical literals", () => {
    expect(QueryKind.create("  decision ").value).toBe("decision");
  });

  it("create rejects empty / non-string / unknown", () => {
    expect(() => QueryKind.create("")).toThrow(InvalidQueryError);
    expect(() => QueryKind.create("nope")).toThrow(InvalidQueryError);
    expect(() =>
      QueryKind.create(null as unknown as string),
    ).toThrow(InvalidQueryError);
  });

  it("isValue type guard", () => {
    expect(QueryKind.isValue("decision")).toBe(true);
    expect(QueryKind.isValue("nope")).toBe(false);
  });

  it("all returns canonical catalog", () => {
    expect(QueryKind.all().length).toBe(5);
  });

  it("equals", () => {
    expect(QueryKind.task().equals(QueryKind.task())).toBe(true);
    expect(QueryKind.task().equals(QueryKind.entity())).toBe(false);
  });
});

describe("Query", () => {
  it("creates with empty kinds (search every kind)", () => {
    const q = Query.create({
      text: QueryText.create("anything"),
      kinds: [],
      tags: Tags.empty(),
      mustHaveTags: Tags.empty(),
      mustNotHaveTags: Tags.empty(),
      includeSuperseded: false,
    });
    expect(q.hasNoKindFilter()).toBe(true);
    expect(q.matchesKind(QueryKind.decision())).toBe(true);
  });

  it("matchesKind for explicit filter", () => {
    const q = Query.create({
      text: QueryText.create("foo"),
      kinds: [QueryKind.decision(), QueryKind.task()],
      tags: Tags.empty(),
      mustHaveTags: Tags.empty(),
      mustNotHaveTags: Tags.empty(),
      includeSuperseded: false,
    });
    expect(q.matchesKind(QueryKind.decision())).toBe(true);
    expect(q.matchesKind(QueryKind.task())).toBe(true);
    expect(q.matchesKind(QueryKind.learning())).toBe(false);
  });

  it("dedupes kinds", () => {
    const q = Query.create({
      text: QueryText.create("foo"),
      kinds: [QueryKind.decision(), QueryKind.decision()],
      tags: Tags.empty(),
      mustHaveTags: Tags.empty(),
      mustNotHaveTags: Tags.empty(),
      includeSuperseded: false,
    });
    expect(q.getKinds().length).toBe(1);
  });

  it("rejects contradictory tag filters", () => {
    expect(() =>
      Query.create({
        text: QueryText.create("foo"),
        kinds: [],
        tags: Tags.empty(),
        mustHaveTags: Tags.create(["security"]),
        mustNotHaveTags: Tags.create(["security"]),
        includeSuperseded: false,
      }),
    ).toThrow(InvalidQueryError);
  });

  it("getKindValues exposes literals", () => {
    const q = Query.create({
      text: QueryText.create("foo"),
      kinds: [QueryKind.decision()],
      tags: Tags.empty(),
      mustHaveTags: Tags.empty(),
      mustNotHaveTags: Tags.empty(),
      includeSuperseded: false,
    });
    expect(q.getKindValues()).toEqual(["decision"]);
  });

  it("equals compares all fields", () => {
    const opts = {
      text: QueryText.create("foo"),
      kinds: [QueryKind.decision()],
      tags: Tags.empty(),
      mustHaveTags: Tags.empty(),
      mustNotHaveTags: Tags.empty(),
      includeSuperseded: false,
    };
    const a = Query.create(opts);
    const b = Query.create(opts);
    expect(a.equals(b)).toBe(true);
    expect(a.equals(a)).toBe(true);
  });
});

describe("TokenBudget", () => {
  it("withMax creates a fresh budget", () => {
    const b = TokenBudget.withMax(100);
    expect(b.maxTokens).toBe(100);
    expect(b.usedTokens).toBe(0);
  });

  it("withMax rejects non-positive / fractional / non-finite", () => {
    expect(() => TokenBudget.withMax(0)).toThrow(InvalidInputError);
    expect(() => TokenBudget.withMax(-1)).toThrow(InvalidInputError);
    expect(() => TokenBudget.withMax(1.5)).toThrow(InvalidInputError);
    expect(() => TokenBudget.withMax(Number.POSITIVE_INFINITY)).toThrow(
      InvalidInputError,
    );
  });

  it("of accepts an existing partial budget", () => {
    const b = TokenBudget.of({ maxTokens: 100, usedTokens: 30 });
    expect(b.remaining().toNumber()).toBe(70);
  });

  it("of rejects used > max", () => {
    expect(() =>
      TokenBudget.of({ maxTokens: 10, usedTokens: 11 }),
    ).toThrow(InvalidInputError);
  });

  it("of rejects negative used / non-integer max", () => {
    expect(() =>
      TokenBudget.of({ maxTokens: 10, usedTokens: -1 }),
    ).toThrow(InvalidInputError);
    expect(() =>
      TokenBudget.of({ maxTokens: 10.5, usedTokens: 0 }),
    ).toThrow(InvalidInputError);
  });

  it("canFit", () => {
    const b = TokenBudget.withMax(100);
    expect(b.canFit(Tokens.of(50))).toBe(true);
    expect(b.canFit(Tokens.of(100))).toBe(true);
    expect(b.canFit(Tokens.of(101))).toBe(false);
  });

  it("consume returns a new budget", () => {
    const b = TokenBudget.withMax(100);
    const after = b.consume(Tokens.of(30));
    expect(after.usedTokens).toBe(30);
    // original is untouched
    expect(b.usedTokens).toBe(0);
  });

  it("consume throws on overflow", () => {
    const b = TokenBudget.withMax(100);
    expect(() => b.consume(Tokens.of(101))).toThrow(TokenBudgetExceededError);
  });

  it("isExhausted", () => {
    const b = TokenBudget.withMax(10);
    expect(b.isExhausted()).toBe(false);
    expect(b.consume(Tokens.of(10)).isExhausted()).toBe(true);
  });

  it("equals", () => {
    expect(TokenBudget.withMax(10).equals(TokenBudget.withMax(10))).toBe(true);
    expect(TokenBudget.withMax(10).equals(TokenBudget.withMax(20))).toBe(false);
  });
});

describe("RecallFilters", () => {
  const baseInput = {
    kinds: [],
    tags: Tags.empty(),
    mustHaveTags: Tags.empty(),
    mustNotHaveTags: Tags.empty(),
    minConfidence: null,
    since: null,
    until: null,
    limit: 10,
  };

  it("creates with valid inputs", () => {
    const f = RecallFilters.create(baseInput);
    expect(f.limit).toBe(10);
    expect(f.hasNoKindFilter()).toBe(true);
  });

  it("rejects non-positive limit", () => {
    expect(() =>
      RecallFilters.create({ ...baseInput, limit: 0 }),
    ).toThrow(InvalidRecallFiltersError);
    expect(() =>
      RecallFilters.create({ ...baseInput, limit: -1 }),
    ).toThrow(InvalidRecallFiltersError);
  });

  it("rejects fractional / non-finite / overflowing limit", () => {
    expect(() =>
      RecallFilters.create({ ...baseInput, limit: 1.5 }),
    ).toThrow(InvalidRecallFiltersError);
    expect(() =>
      RecallFilters.create({ ...baseInput, limit: Number.NaN }),
    ).toThrow(InvalidRecallFiltersError);
    expect(() =>
      RecallFilters.create({ ...baseInput, limit: 101 }),
    ).toThrow(InvalidRecallFiltersError);
  });

  it("rejects since > until", () => {
    expect(() =>
      RecallFilters.create({
        ...baseInput,
        since: makeTimestamp(ANCHOR_TIME_MS + 1000),
        until: makeTimestamp(ANCHOR_TIME_MS),
      }),
    ).toThrow(InvalidRecallFiltersError);
  });

  it("rejects contradictory tag filter", () => {
    expect(() =>
      RecallFilters.create({
        ...baseInput,
        mustHaveTags: Tags.create(["a"]),
        mustNotHaveTags: Tags.create(["a"]),
      }),
    ).toThrow(InvalidRecallFiltersError);
  });

  it("dedupes kinds", () => {
    const f = RecallFilters.create({
      ...baseInput,
      kinds: [QueryKind.decision(), QueryKind.decision()],
    });
    expect(f.getKinds().length).toBe(1);
  });

  it("equals reflects all fields", () => {
    const a = RecallFilters.create(baseInput);
    const b = RecallFilters.create(baseInput);
    expect(a.equals(b)).toBe(true);
    expect(a.equals(a)).toBe(true);
  });
});

describe("ContextLayerKind", () => {
  it("factories return canonical kinds", () => {
    expect(ContextLayerKind.workspaceAnchor().toString()).toBe(
      "workspace_anchor",
    );
    expect(ContextLayerKind.activeDecisions().toString()).toBe(
      "active_decisions",
    );
    expect(ContextLayerKind.openTasks().toString()).toBe("open_tasks");
    expect(ContextLayerKind.recentTurns().toString()).toBe("recent_turns");
    expect(ContextLayerKind.relevantMemory().toString()).toBe(
      "relevant_memory",
    );
    expect(ContextLayerKind.entitiesInFocus().toString()).toBe(
      "entities_in_focus",
    );
    expect(ContextLayerKind.openQuestions().toString()).toBe("open_questions");
  });

  it("priority returns 1..7", () => {
    expect(ContextLayerKind.workspaceAnchor().priority()).toBe(1);
    expect(ContextLayerKind.openQuestions().priority()).toBe(7);
  });

  it("create rejects unknown / empty / non-string", () => {
    expect(() => ContextLayerKind.create("nope")).toThrow(InvalidInputError);
    expect(() => ContextLayerKind.create("")).toThrow(InvalidInputError);
    expect(() =>
      ContextLayerKind.create(123 as unknown as string),
    ).toThrow(InvalidInputError);
  });

  it("all returns 7 values", () => {
    expect(ContextLayerKind.all().length).toBe(7);
  });
});

describe("BM25Score", () => {
  it("of accepts non-negative", () => {
    expect(BM25Score.of(0).toNumber()).toBe(0);
    expect(BM25Score.of(2).toNumber()).toBe(2);
  });

  it("rejects negative / non-finite", () => {
    expect(() => BM25Score.of(-1)).toThrow(InvalidInputError);
    expect(() => BM25Score.of(Number.NaN)).toThrow(InvalidInputError);
  });

  it("fromRawNegated flips sign and clamps", () => {
    expect(BM25Score.fromRawNegated(-1).toNumber()).toBe(1);
    // -0 is normalised through the (< 0 ? 0 : flipped) branch — comparison
    // tolerated by Math.abs so we side-step Object.is(+0, -0) === false.
    expect(Math.abs(BM25Score.fromRawNegated(0).toNumber())).toBe(0);
    expect(BM25Score.fromRawNegated(1).toNumber()).toBe(0);
  });

  it("fromRawNegated rejects non-finite", () => {
    expect(() => BM25Score.fromRawNegated(Number.NaN)).toThrow(
      InvalidInputError,
    );
  });

  it("normalize divides by max", () => {
    expect(BM25Score.of(2).normalize(4).toNumber()).toBe(0.5);
  });

  it("normalize returns 0 when max <= 0", () => {
    expect(BM25Score.of(2).normalize(0).toNumber()).toBe(0);
    expect(BM25Score.of(2).normalize(-5).toNumber()).toBe(0);
  });

  it("normalize rejects non-finite max", () => {
    expect(() => BM25Score.of(2).normalize(Number.NaN)).toThrow(
      InvalidInputError,
    );
  });

  it("normalize clamps result above 1", () => {
    expect(BM25Score.of(10).normalize(2).toNumber()).toBe(1);
  });

  it("isZero / equals", () => {
    expect(BM25Score.zero().isZero()).toBe(true);
    expect(BM25Score.of(1).equals(BM25Score.of(1))).toBe(true);
  });
});

describe("CosineScore (retrieval)", () => {
  it("of clamps negative to 0", () => {
    expect(CosineScore.of(-0.5).toNumber()).toBe(0);
  });

  it("of accepts [0, 1]", () => {
    expect(CosineScore.of(0).toNumber()).toBe(0);
    expect(CosineScore.of(1).toNumber()).toBe(1);
  });

  it("of rejects > 1 / non-finite", () => {
    expect(() => CosineScore.of(1.1)).toThrow(InvalidInputError);
    expect(() => CosineScore.of(Number.NaN)).toThrow(InvalidInputError);
  });

  it("fromDistance converts [0, 2] distance to similarity", () => {
    expect(CosineScore.fromDistance(0).toNumber()).toBe(1);
    expect(CosineScore.fromDistance(1).toNumber()).toBe(0);
    expect(CosineScore.fromDistance(2).toNumber()).toBe(0); // clamped
  });

  it("fromDistance rejects negative / non-finite", () => {
    expect(() => CosineScore.fromDistance(-1)).toThrow(InvalidInputError);
    expect(() => CosineScore.fromDistance(Number.NaN)).toThrow(
      InvalidInputError,
    );
  });

  it("isZero / equals", () => {
    expect(CosineScore.zero().isZero()).toBe(true);
    expect(CosineScore.one().toNumber()).toBe(1);
  });
});

describe("RecencyScore", () => {
  it("of accepts [0, 1]", () => {
    expect(RecencyScore.of(0).toNumber()).toBe(0);
    expect(RecencyScore.of(1).toNumber()).toBe(1);
  });

  it("of rejects out-of-range / non-finite", () => {
    expect(() => RecencyScore.of(-0.1)).toThrow(InvalidInputError);
    expect(() => RecencyScore.of(1.1)).toThrow(InvalidInputError);
    expect(() => RecencyScore.of(Number.NaN)).toThrow(InvalidInputError);
  });

  it("compute returns 0 for never-used", () => {
    const r = RecencyScore.compute(
      makeTimestamp(),
      LastUsed.never(),
      24 * 60 * 60 * 1000,
    );
    expect(r.toNumber()).toBe(0);
  });

  it("compute rejects non-positive halfLife", () => {
    expect(() =>
      RecencyScore.compute(makeTimestamp(), LastUsed.never(), 0),
    ).toThrow(InvalidInputError);
    expect(() =>
      RecencyScore.compute(makeTimestamp(), LastUsed.never(), -1),
    ).toThrow(InvalidInputError);
    expect(() =>
      RecencyScore.compute(makeTimestamp(), LastUsed.never(), Number.NaN),
    ).toThrow(InvalidInputError);
  });

  it("compute returns 1 when used at the same instant", () => {
    const r = RecencyScore.compute(
      makeTimestamp(),
      LastUsed.at(makeTimestamp()),
      1000,
    );
    expect(r.toNumber()).toBe(1);
  });

  it("compute is 0.5 at one half-life elapsed", () => {
    const halfLifeMs = 1000;
    const r = RecencyScore.compute(
      makeTimestamp(ANCHOR_TIME_MS + halfLifeMs),
      LastUsed.at(makeTimestamp(ANCHOR_TIME_MS)),
      halfLifeMs,
    );
    expect(r.toNumber()).toBeCloseTo(0.5, 5);
  });

  it("compute clamps to 1 on negative elapsed (clock skew)", () => {
    const r = RecencyScore.compute(
      makeTimestamp(ANCHOR_TIME_MS),
      LastUsed.at(makeTimestamp(ANCHOR_TIME_MS + 1000)),
      1000,
    );
    expect(r.toNumber()).toBe(1);
  });
});

describe("UsageScore", () => {
  it("of accepts [0, 1]", () => {
    expect(UsageScore.of(0).toNumber()).toBe(0);
    expect(UsageScore.of(1).toNumber()).toBe(1);
  });

  it("of rejects out of range / non-finite", () => {
    expect(() => UsageScore.of(-0.1)).toThrow(InvalidInputError);
    expect(() => UsageScore.of(1.1)).toThrow(InvalidInputError);
    expect(() => UsageScore.of(Number.NaN)).toThrow(InvalidInputError);
  });

  it("compute returns 0 when max=0", () => {
    expect(UsageScore.compute(UseCount.of(0), 0).toNumber()).toBe(0);
  });

  it("compute saturates at 1 when useCount > max", () => {
    expect(UsageScore.compute(UseCount.of(20), 10).toNumber()).toBe(1);
  });

  it("compute is linear", () => {
    expect(UsageScore.compute(UseCount.of(5), 10).toNumber()).toBe(0.5);
  });

  it("compute rejects bad max", () => {
    expect(() =>
      UsageScore.compute(UseCount.of(5), -1),
    ).toThrow(InvalidInputError);
    expect(() =>
      UsageScore.compute(UseCount.of(5), 1.5),
    ).toThrow(InvalidInputError);
    expect(() =>
      UsageScore.compute(UseCount.of(5), Number.POSITIVE_INFINITY),
    ).toThrow(InvalidInputError);
  });
});

describe("PriorityBoost", () => {
  it("none is 1", () => {
    expect(PriorityBoost.none().toNumber()).toBe(1);
    expect(PriorityBoost.none().isNeutral()).toBe(true);
  });

  it("of accepts [1, 10]", () => {
    expect(PriorityBoost.of(1).toNumber()).toBe(1);
    expect(PriorityBoost.of(10).toNumber()).toBe(10);
  });

  it("of rejects < 1 / > 10 / non-finite", () => {
    expect(() => PriorityBoost.of(0.9)).toThrow(InvalidInputError);
    expect(() => PriorityBoost.of(11)).toThrow(InvalidInputError);
    expect(() => PriorityBoost.of(Number.NaN)).toThrow(InvalidInputError);
  });

  it("equals", () => {
    expect(PriorityBoost.of(2).equals(PriorityBoost.of(2))).toBe(true);
    expect(PriorityBoost.of(2).equals(PriorityBoost.of(3))).toBe(false);
  });
});

describe("RelevanceScore", () => {
  it("zero is 0", () => {
    expect(RelevanceScore.zero().toNumber()).toBe(0);
  });

  it("of validates non-negative finite", () => {
    expect(RelevanceScore.of(0.5).toNumber()).toBe(0.5);
    expect(() => RelevanceScore.of(-1)).toThrow(InvalidInputError);
    expect(() => RelevanceScore.of(Number.NaN)).toThrow(InvalidInputError);
  });

  it("isHigherThan is strict", () => {
    expect(RelevanceScore.of(1).isHigherThan(RelevanceScore.of(0.5))).toBe(true);
    expect(RelevanceScore.of(1).isHigherThan(RelevanceScore.of(1))).toBe(false);
  });

  it("equals", () => {
    expect(RelevanceScore.of(0.5).equals(RelevanceScore.of(0.5))).toBe(true);
  });

  it("getters return null for components when built via of(...)", () => {
    const rs = RelevanceScore.of(0.5);
    expect(rs.getBM25()).toBe(null);
    expect(rs.getCosine()).toBe(null);
    expect(rs.getRecency()).toBe(null);
    expect(rs.getUsage()).toBe(null);
    expect(rs.getPriorityBoost()).toBe(null);
    expect(rs.getWeights()).toBe(null);
  });
});

describe("RelevanceWeights", () => {
  it("defaults match the doc spec", () => {
    const w = RelevanceWeights.defaults();
    expect(w.bm25Weight).toBe(0.2);
    expect(w.cosineWeight).toBe(0.4);
    expect(w.recencyWeight).toBe(0.2);
    expect(w.usageWeight).toBe(0.15);
  });

  it("of validates each weight non-negative finite", () => {
    expect(() =>
      RelevanceWeights.of({
        bm25Weight: -0.1,
        cosineWeight: 0.4,
        recencyWeight: 0.2,
        usageWeight: 0.15,
      }),
    ).toThrow(InvalidInputError);
    expect(() =>
      RelevanceWeights.of({
        bm25Weight: Number.NaN,
        cosineWeight: 0.4,
        recencyWeight: 0.2,
        usageWeight: 0.15,
      }),
    ).toThrow(InvalidInputError);
  });

  it("of rejects all-zero weights", () => {
    expect(() =>
      RelevanceWeights.of({
        bm25Weight: 0,
        cosineWeight: 0,
        recencyWeight: 0,
        usageWeight: 0,
      }),
    ).toThrow(InvalidInputError);
  });

  it("sum returns the total", () => {
    expect(RelevanceWeights.defaults().sum()).toBeCloseTo(0.95, 5);
  });

  it("equals compares all weights", () => {
    expect(
      RelevanceWeights.defaults().equals(RelevanceWeights.defaults()),
    ).toBe(true);
  });
});

// Confidence is shared but used as a precondition reference here.
describe("Confidence usage in retrieval", () => {
  it("Confidence.of accepts valid values", () => {
    expect(Confidence.of(0.5).toNumber()).toBe(0.5);
  });
});
