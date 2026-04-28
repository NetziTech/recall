import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";
import type { BM25Score } from "./bm25-score.ts";
import type { CosineScore } from "./cosine-score.ts";
import type { PriorityBoost } from "./priority-boost.ts";
import type { RecencyScore } from "./recency-score.ts";
import type { RelevanceWeights } from "./relevance-weights.ts";
import type { UsageScore } from "./usage-score.ts";

/**
 * Composite value object representing the final relevance score of a
 * retrieved entry, after the hybrid scorer fuses BM25, cosine, recency,
 * usage, and priority signals.
 *
 * The score is non-negative; it is NOT bounded above by `1` because the
 * priority boost is multiplicative and can scale the post-fusion sum
 * past 1 (see `PriorityBoost`). Callers that need a normalised score
 * for presentation should divide by the largest score in the result
 * set (the recall pipeline does this when serialising for the JSON-RPC
 * `score` field of `MemoryEntry`, which is documented as "0..1 final
 * score" in `docs/02-protocolo-mcp.md` §4.3 — that normalisation is a
 * presentation concern, not a domain one).
 *
 * Invariants:
 * - `score` is a finite, non-negative number.
 * - When constructed via `assemble(...)`, the components and the
 *   weights are stored verbatim so the recall pipeline can introspect
 *   and explain the score (useful for the audit log).
 * - Instances are immutable.
 */
export class RelevanceScore {
  private constructor(
    public readonly score: number,
    private readonly bm25?: BM25Score,
    private readonly cosine?: CosineScore,
    private readonly recency?: RecencyScore,
    private readonly usage?: UsageScore,
    private readonly priorityBoost?: PriorityBoost,
    private readonly weights?: RelevanceWeights,
  ) {}

  /**
   * Convenience: zero relevance.
   */
  public static zero(): RelevanceScore {
    return new RelevanceScore(0);
  }

  /**
   * Builds a `RelevanceScore` from a precomputed numeric value. Used by
   * tests and by adapters that already have a final score (e.g. when
   * deserialising from an audit row).
   */
  public static of(value: number): RelevanceScore {
    if (!Number.isFinite(value)) {
      throw new InvalidInputError("relevance score must be a finite number", {
        field: "relevance_score",
      });
    }
    if (value < 0) {
      throw new InvalidInputError(
        `relevance score must be non-negative (got: ${String(value)})`,
        { field: "relevance_score" },
      );
    }
    return new RelevanceScore(value);
  }

  /**
   * Assembles a `RelevanceScore` from its five components and the
   * weights. Performs the same arithmetic as `HybridScorer` but exposes
   * it as a factory so callers that prefer a value-object construction
   * style get the same result; the service is the canonical entry
   * point.
   *
   * Algorithm:
   * ```
   * additive = bm25 * bm25Weight
   *          + cosine * cosineWeight
   *          + recency * recencyWeight
   *          + usage * usageWeight
   * relevance = additive * priorityBoost
   * ```
   *
   * Missing components (e.g. `bm25 === null` because the entry was
   * retrieved by vector search alone) contribute `0` to the additive
   * sum; the corresponding weight is wasted, which intentionally
   * penalises entries that hit only one signal.
   */
  public static assemble(input: {
    bm25: BM25Score | null;
    cosine: CosineScore | null;
    recency: RecencyScore;
    usage: UsageScore;
    priorityBoost: PriorityBoost;
    weights: RelevanceWeights;
  }): RelevanceScore {
    const bm25Term =
      input.bm25 === null ? 0 : input.bm25.toNumber() * input.weights.bm25Weight;
    const cosineTerm =
      input.cosine === null
        ? 0
        : input.cosine.toNumber() * input.weights.cosineWeight;
    const recencyTerm = input.recency.toNumber() * input.weights.recencyWeight;
    const usageTerm = input.usage.toNumber() * input.weights.usageWeight;
    const additive = bm25Term + cosineTerm + recencyTerm + usageTerm;
    const final = additive * input.priorityBoost.toNumber();
    const safe = final < 0 ? 0 : final;
    return new RelevanceScore(
      safe,
      input.bm25 ?? undefined,
      input.cosine ?? undefined,
      input.recency,
      input.usage,
      input.priorityBoost,
      input.weights,
    );
  }

  public toNumber(): number {
    return this.score;
  }

  /**
   * Returns the BM25 component used to assemble this score, or `null`
   * when the entry had no lexical hit (or this score was constructed
   * via `of(...)` without component context).
   */
  public getBM25(): BM25Score | null {
    return this.bm25 ?? null;
  }

  public getCosine(): CosineScore | null {
    return this.cosine ?? null;
  }

  public getRecency(): RecencyScore | null {
    return this.recency ?? null;
  }

  public getUsage(): UsageScore | null {
    return this.usage ?? null;
  }

  public getPriorityBoost(): PriorityBoost | null {
    return this.priorityBoost ?? null;
  }

  public getWeights(): RelevanceWeights | null {
    return this.weights ?? null;
  }

  /**
   * True iff `this.score > other.score`. Stable tiebreak (returns
   * `false` for ties) so callers can use it as a `>` comparator
   * directly.
   */
  public isHigherThan(other: RelevanceScore): boolean {
    return this.score > other.score;
  }

  public equals(other: RelevanceScore): boolean {
    return this.score === other.score;
  }
}
