import { InvalidConsolidationPairError } from "../errors/invalid-consolidation-pair-error.ts";
import type { AffectedEntryRef } from "./affected-entry-ref.ts";
import type { CosineScore } from "./cosine-score.ts";

/**
 * Value object representing a single consolidation candidate produced
 * by the curator's de-duplication pass.
 *
 * Mirrors the `mergePair(a, b)` algorithm in
 * `docs/05-memoria-decay.md` §3: the two learnings are scored, the
 * "winner" is the one with the higher `score(use_count + confidence)`
 * heuristic, and the "loser" is folded into the winner via
 * `Learning.consolidateInto(winner.id)`. The pair carries the
 * `cosineScore` that triggered the candidate so the audit log can
 * reproduce why the merge happened.
 *
 * The pair is *just* a recommendation. The actual merge is performed
 * by the application layer, which:
 * 1. Loads both aggregates from the repository.
 * 2. Calls `Learning.consolidateInto(...)` on the loser.
 * 3. Saves the loser, drains its events, and increments the
 *    `learningsConsolidated` counter on `CuratorRunStats`.
 *
 * Invariants:
 * - `winner` and `loser` reference different entries (`winner !==
 *   loser`).
 * - `winner.kind === loser.kind`: cross-kind consolidation is not
 *   supported.
 * - `cosineScore` is a valid `CosineScore`. The factory does NOT
 *   enforce that the score be above any consolidation threshold —
 *   that decision belongs to the caller (a `ConsolidationDetector`
 *   adapter typically supplies pairs that already qualify, but the
 *   VO does not assume so).
 * - Instances are immutable.
 *
 * Equality:
 * - Two `ConsolidationPair` are equal iff `winner`, `loser`, and
 *   `cosineScore` all match.
 */
export class ConsolidationPair {
  private constructor(
    public readonly winner: AffectedEntryRef,
    public readonly loser: AffectedEntryRef,
    public readonly cosineScore: CosineScore,
  ) {}

  /**
   * Builds a `ConsolidationPair`. Refuses self-pairs and cross-kind
   * pairs.
   */
  public static of(input: {
    winner: AffectedEntryRef;
    loser: AffectedEntryRef;
    cosineScore: CosineScore;
  }): ConsolidationPair {
    if (input.winner.equals(input.loser)) {
      throw new InvalidConsolidationPairError(
        input.winner,
        input.loser,
        "winner and loser refer to the same entry",
      );
    }
    if (!input.winner.kind.equals(input.loser.kind)) {
      throw new InvalidConsolidationPairError(
        input.winner,
        input.loser,
        "winner and loser belong to different memory kinds",
      );
    }
    return new ConsolidationPair(
      input.winner,
      input.loser,
      input.cosineScore,
    );
  }

  public equals(other: ConsolidationPair): boolean {
    if (this === other) return true;
    if (!this.winner.equals(other.winner)) return false;
    if (!this.loser.equals(other.loser)) return false;
    if (!this.cosineScore.equals(other.cosineScore)) return false;
    return true;
  }
}
