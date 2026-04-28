import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { LastUsed } from "../../../memory/domain/value-objects/last-used.ts";

/**
 * Value object representing the recency component of the hybrid score.
 *
 * Mirrors `recency_decay` from the scoring formula in
 * `docs/01-arquitectura.md` §2.6:
 * ```
 * final_score = ... + 0.2 * recency_decay + ...
 * ```
 *
 * Algorithm (exponential decay with a configurable half-life):
 * ```
 * elapsed   = now - lastUsed
 * recency   = 0.5 ** (elapsed / halfLifeMs)
 * ```
 * The function is `1.0` when `elapsed === 0` and falls towards `0` as
 * the entry ages; one half-life later it sits at `0.5`. This shape is
 * the standard "recency boost" used by recommendation systems and is
 * compatible with the curator decay model
 * (`docs/05-memoria-decay.md` mentions a per-month decay of `0.95` —
 * the recall-time recency is independent of that bookkeeping; both
 * model the same intuition that fresher = more relevant).
 *
 * Edge cases:
 * - When the entry has never been used (`LastUsed.never()`), the score
 *   is `0` — the entry has no recency information so it cannot
 *   contribute. The hybrid scorer adds it with whatever weight the
 *   caller picked; effectively it does not boost anything.
 * - When `halfLifeMs <= 0`, the factory rejects the input. A non-
 *   positive half-life would either produce `NaN` (if zero) or amplify
 *   recency exponentially (if negative), neither of which is a valid
 *   model.
 *
 * Invariants:
 * - `score` is a finite number in the closed interval [0, 1].
 * - Instances are immutable.
 *
 * Equality:
 * - Two `RecencyScore` are equal iff their numeric values match.
 */
export class RecencyScore {
  private constructor(public readonly score: number) {}

  /**
   * Maximum recency. Reserved for entries used at the same instant the
   * query is being executed.
   */
  public static one(): RecencyScore {
    return new RecencyScore(1);
  }

  /**
   * Zero recency. Used when the entry has never been surfaced.
   */
  public static zero(): RecencyScore {
    return new RecencyScore(0);
  }

  /**
   * Builds a `RecencyScore` from an already-clamped numeric value in
   * [0, 1].
   */
  public static of(value: number): RecencyScore {
    if (!Number.isFinite(value)) {
      throw new InvalidInputError("recency score must be a finite number", {
        field: "recency_score",
      });
    }
    if (value < 0 || value > 1) {
      throw new InvalidInputError(
        `recency score must be in the closed interval [0, 1] (got: ${String(value)})`,
        { field: "recency_score" },
      );
    }
    return new RecencyScore(value);
  }

  /**
   * Computes the recency score for an entry given the moment of the
   * query (`now`), the entry's last-used timestamp, and the recency
   * half-life in milliseconds.
   *
   * - If the entry has never been used, returns `0`.
   * - If `now` predates the entry's last-used moment (clock skew or a
   *   timestamp written by a different process), the elapsed time is
   *   clamped to `0` and the score is `1.0`.
   */
  public static compute(
    now: Timestamp,
    lastUsed: LastUsed,
    halfLifeMs: number,
  ): RecencyScore {
    if (!Number.isFinite(halfLifeMs)) {
      throw new InvalidInputError(
        "recency half-life must be a finite number of milliseconds",
        { field: "half_life_ms" },
      );
    }
    if (halfLifeMs <= 0) {
      throw new InvalidInputError(
        `recency half-life must be strictly positive (got: ${String(halfLifeMs)})`,
        { field: "half_life_ms" },
      );
    }
    const elapsed = lastUsed.millisecondsSince(now);
    if (elapsed === null) return new RecencyScore(0);
    const decay = Math.pow(0.5, elapsed / halfLifeMs);
    const clamped = decay < 0 ? 0 : decay > 1 ? 1 : decay;
    return new RecencyScore(clamped);
  }

  public toNumber(): number {
    return this.score;
  }

  public equals(other: RecencyScore): boolean {
    return this.score === other.score;
  }
}
