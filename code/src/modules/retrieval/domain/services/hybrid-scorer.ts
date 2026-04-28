import type { BM25Score } from "../value-objects/bm25-score.ts";
import type { CosineScore } from "../value-objects/cosine-score.ts";
import type { PriorityBoost } from "../value-objects/priority-boost.ts";
import type { RecencyScore } from "../value-objects/recency-score.ts";
import { RelevanceScore } from "../value-objects/relevance-score.ts";
import type { RelevanceWeights } from "../value-objects/relevance-weights.ts";
import type { UsageScore } from "../value-objects/usage-score.ts";

/**
 * Domain service that fuses the five hybrid-score signals into a
 * single `RelevanceScore`.
 *
 * This is a domain service (NOT a port) for two reasons:
 *
 * 1. **The arithmetic is the business rule.** The fusion formula —
 *    `additive = bm25 * w_bm25 + cosine * w_cosine + recency * w_rec
 *    + usage * w_use; final = additive * priorityBoost` — is the
 *    canonical "what does relevance mean in this product" decision
 *    documented in `docs/01-arquitectura.md` §2.6. There is no
 *    technology choice to abstract: it is not "the FTS5 ranker" or
 *    "the embedder normaliser", it is the recall pipeline's own
 *    definition of relevance.
 *
 * 2. **It is pure.** The service has no fields, no I/O, no
 *    dependencies on adapters. Every input is already a value object;
 *    every output is a value object. Two calls with the same inputs
 *    produce structurally-equal outputs.
 *
 * The class is `static` (a stateless namespace). An interface would
 * imply pluggability, which is the wrong abstraction here: changing
 * the fusion formula is changing the *business* — the only legitimate
 * way to vary it is via the `RelevanceWeights` argument and the
 * `PriorityBoost`.
 *
 * Usage:
 * ```typescript
 * const score = HybridScorer.score({
 *   bm25, cosine, recency, usage, priorityBoost, weights,
 * });
 * ```
 *
 * Behaviour notes:
 * - Missing components (`bm25 === null` or `cosine === null`) are
 *   treated as `0` in the additive sum. The corresponding weight is
 *   wasted, which intentionally penalises entries that hit only one
 *   signal (the reasoning is that an entry retrieved by both lexical
 *   and semantic search is more trustworthy than one retrieved by
 *   only one).
 * - The result is non-negative (the `RelevanceScore` factory clamps
 *   any rounding-induced negative).
 * - The result is NOT bounded above by `1`: the `priorityBoost`
 *   multiplier is allowed to scale the score past `1` — this is the
 *   intended semantics for `critical` learnings.
 */
// `no-extraneous-class` would prefer free functions or a plain object,
// but the SOLID-validator (`phase-1-task-8-solid-validator.md`)
// explicitly approves the static-only class as a stateless namespace
// for a domain service that codifies the hybrid-relevance fusion
// formula. The `private constructor()` keeps the class effectively
// final and preserves DIP (zero adapters, zero state).
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class HybridScorer {
  private constructor() {
    // never instantiated
  }

  /**
   * Computes the hybrid score for a single candidate. Delegates to
   * `RelevanceScore.assemble(...)` which holds the canonical formula.
   */
  public static score(input: {
    bm25: BM25Score | null;
    cosine: CosineScore | null;
    recency: RecencyScore;
    usage: UsageScore;
    priorityBoost: PriorityBoost;
    weights: RelevanceWeights;
  }): RelevanceScore {
    return RelevanceScore.assemble({
      bm25: input.bm25,
      cosine: input.cosine,
      recency: input.recency,
      usage: input.usage,
      priorityBoost: input.priorityBoost,
      weights: input.weights,
    });
  }
}
