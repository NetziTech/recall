import { describe, expect, it } from "vitest";
import { HybridScorer } from "../../../../src/modules/retrieval/domain/services/hybrid-scorer.ts";
import { BM25Score } from "../../../../src/modules/retrieval/domain/value-objects/bm25-score.ts";
import { CosineScore } from "../../../../src/modules/retrieval/domain/value-objects/cosine-score.ts";
import { RecencyScore } from "../../../../src/modules/retrieval/domain/value-objects/recency-score.ts";
import { UsageScore } from "../../../../src/modules/retrieval/domain/value-objects/usage-score.ts";
import { PriorityBoost } from "../../../../src/modules/retrieval/domain/value-objects/priority-boost.ts";
import { RelevanceWeights } from "../../../../src/modules/retrieval/domain/value-objects/relevance-weights.ts";

describe("HybridScorer.score", () => {
  const weights = RelevanceWeights.defaults();

  it("computes the additive sum * priority for full hits", () => {
    const score = HybridScorer.score({
      bm25: BM25Score.of(0.5),
      cosine: CosineScore.of(0.8),
      recency: RecencyScore.of(0.5),
      usage: UsageScore.of(0.2),
      priorityBoost: PriorityBoost.none(),
      weights,
    });
    // 0.5*0.2 + 0.8*0.4 + 0.5*0.2 + 0.2*0.15 = 0.1 + 0.32 + 0.1 + 0.03 = 0.55
    expect(score.toNumber()).toBeCloseTo(0.55, 5);
  });

  it("treats null bm25 as 0 contribution", () => {
    const withBm = HybridScorer.score({
      bm25: BM25Score.of(0.5),
      cosine: CosineScore.of(0.5),
      recency: RecencyScore.of(0),
      usage: UsageScore.of(0),
      priorityBoost: PriorityBoost.none(),
      weights,
    });
    const withoutBm = HybridScorer.score({
      bm25: null,
      cosine: CosineScore.of(0.5),
      recency: RecencyScore.of(0),
      usage: UsageScore.of(0),
      priorityBoost: PriorityBoost.none(),
      weights,
    });
    expect(withoutBm.toNumber()).toBeLessThan(withBm.toNumber());
    // 0.5 * 0.4 = 0.2
    expect(withoutBm.toNumber()).toBeCloseTo(0.2, 5);
  });

  it("treats null cosine as 0 contribution", () => {
    const score = HybridScorer.score({
      bm25: BM25Score.of(1),
      cosine: null,
      recency: RecencyScore.of(0),
      usage: UsageScore.of(0),
      priorityBoost: PriorityBoost.none(),
      weights,
    });
    // 1 * 0.2 = 0.2
    expect(score.toNumber()).toBeCloseTo(0.2, 5);
  });

  it("priorityBoost multiplies the post-fusion sum", () => {
    const baseline = HybridScorer.score({
      bm25: BM25Score.of(0.5),
      cosine: CosineScore.of(0.5),
      recency: RecencyScore.of(0.5),
      usage: UsageScore.of(0.5),
      priorityBoost: PriorityBoost.none(),
      weights,
    });
    const boosted = HybridScorer.score({
      bm25: BM25Score.of(0.5),
      cosine: CosineScore.of(0.5),
      recency: RecencyScore.of(0.5),
      usage: UsageScore.of(0.5),
      priorityBoost: PriorityBoost.of(3),
      weights,
    });
    expect(boosted.toNumber()).toBeCloseTo(baseline.toNumber() * 3, 5);
  });

  it("returns a non-negative score even when components are zero", () => {
    const score = HybridScorer.score({
      bm25: BM25Score.zero(),
      cosine: CosineScore.zero(),
      recency: RecencyScore.zero(),
      usage: UsageScore.zero(),
      priorityBoost: PriorityBoost.none(),
      weights,
    });
    expect(score.toNumber()).toBe(0);
  });

  it("score is NOT bounded above by 1 (priority boost can push past)", () => {
    const score = HybridScorer.score({
      bm25: BM25Score.of(1),
      cosine: CosineScore.one(),
      recency: RecencyScore.one(),
      usage: UsageScore.one(),
      priorityBoost: PriorityBoost.of(5),
      weights,
    });
    // Sum = 0.95; * 5 = 4.75
    expect(score.toNumber()).toBeGreaterThan(1);
    expect(score.toNumber()).toBeCloseTo(4.75, 5);
  });

  it("preserves the components on the resulting RelevanceScore", () => {
    const bm25 = BM25Score.of(0.7);
    const cosine = CosineScore.of(0.8);
    const recency = RecencyScore.of(0.4);
    const usage = UsageScore.of(0.1);
    const boost = PriorityBoost.of(1.5);
    const rs = HybridScorer.score({
      bm25,
      cosine,
      recency,
      usage,
      priorityBoost: boost,
      weights,
    });
    expect(rs.getBM25()?.equals(bm25)).toBe(true);
    expect(rs.getCosine()?.equals(cosine)).toBe(true);
    expect(rs.getRecency()?.equals(recency)).toBe(true);
    expect(rs.getUsage()?.equals(usage)).toBe(true);
    expect(rs.getPriorityBoost()?.equals(boost)).toBe(true);
    expect(rs.getWeights()?.equals(weights)).toBe(true);
  });
});
