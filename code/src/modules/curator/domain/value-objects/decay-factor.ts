import type { LearningSeverity } from "../../../memory/domain/value-objects/learning-severity.ts";
import { InvalidDecayFactorError } from "../errors/invalid-decay-factor-error.ts";
import type { MemoryEntryKind } from "./memory-entry-kind.ts";

/**
 * Default decay factors per memory kind, per day.
 *
 * The catalog mirrors the table in `docs/05-memoria-decay.md` §2
 * ("Decay diferencial por kind") with two simplifications the curator
 * domain commits to:
 *
 * 1. The factor is normalised to a *per-day* multiplier, regardless of
 *    the per-kind decay period the docs originally express
 *    (`decision`: 90 days, `learning (tip)`: 30 days, ...). The
 *    `DecayCalculator` exponentiates this factor to the elapsed-day
 *    count (`factor ^ days_elapsed`), so a per-day basis is the easiest
 *    to compose. The literal values in this table are therefore the
 *    *daily* equivalents of the period-based defaults documented in
 *    `docs/05` §2, NOT the period multipliers themselves.
 *
 *    Calibration formula:
 *      `factor_per_day = factor_per_period ^ (1 / period_days)`
 *
 *    For example, the spec's `decision (active)` row says
 *    "factor=0.99, period=90 days", which means "after 90 days of
 *    inactivity the entry's confidence is multiplied by 0.99". To get
 *    the daily multiplier that produces the same 90-day result under
 *    `factor ^ days_elapsed`, we solve `x^90 = 0.99` → `x = 0.99^(1/90)
 *    ≈ 0.999888335836...`, which rounds to 0.999888 at six decimals.
 *
 *    Each constant below carries a JSDoc with its exact derivation.
 *    Values are frozen at six decimals; this is enough precision that
 *    the maximum drift of `factor_per_day^period_days` from the spec's
 *    `factor_per_period` is below 1e-3 (verified by hand for every
 *    row), well within the curator's ranking tolerance.
 *
 * 2. The MVP curator does not yet model the `decision.status`
 *    (`active` vs `superseded`) nor the `task.status` (`open` vs
 *    `done`) discrimination that the spec uses for its decay matrix.
 *    Until the curator's domain models those statuses, the catalog
 *    pins each kind to the *conservative* branch:
 *      - `decision` → `decision (active)` row (slow decay, period 90d).
 *      - `task` → `task (open)` row (no decay).
 *    The worst that can happen with this choice is the user keeping
 *    superseded decisions or done tasks surfaced for longer than the
 *    spec would; the alternative (defaulting to the aggressive branch)
 *    would silently erase still-active entries, which is unacceptable.
 *
 * The defaults are intentionally accessible only through
 * `DecayFactor.forKind(...)` so callers cannot drift from the catalog
 * by reading the literals directly.
 */
const DEFAULT_DECAY_FACTORS_PER_DAY: Readonly<
  Record<ReturnType<MemoryEntryKind["toString"]>, number>
> = Object.freeze({
  /**
   * Derived as `0.99^(1/90)` for `decision (status=active, period=90d)`.
   * Source: docs/05-memoria-decay.md §2 row "decision (active)". The
   * MVP collapses `decision` to the `active` branch (see catalog
   * JSDoc, simplification 2).
   *
   * Exact value: 0.999888335836534... → rounded to 0.999888.
   */
  decision: 0.999888,
  /**
   * Derived as `0.95^(1/30)` for `learning (severity=tip, period=30d)`.
   * Source: docs/05-memoria-decay.md §2 row "learning (tip)".
   *
   * This is the kind-level fallback used when `forKind(...)` is called
   * with `severity === null`. In practice every `Learning` aggregate
   * carries a `LearningSeverity` (column default `'tip'`), so callers
   * normally hit `LEARNING_DECAY_FACTORS_PER_DAY` instead. The
   * fallback is aligned with `tip` so that the kind-level path
   * matches the schema default.
   *
   * Exact value: 0.998291684355534... → rounded to 0.998292.
   */
  learning: 0.998292,
  /**
   * Derived as `0.95^(1/30)` for `entity (period=30d)`.
   * Source: docs/05-memoria-decay.md §2 row "entity".
   *
   * Exact value: 0.998291684355534... → rounded to 0.998292.
   * (Numerically identical to `learning (tip)` — the spec uses the
   * same per-period factor and period for both kinds.)
   */
  entity: 0.998292,
  /**
   * No-decay sentinel for `task`. Source: docs/05-memoria-decay.md §2
   * row "task (open)" (`factor=1.0, period=∞`). The MVP collapses
   * `task` to the `open` branch (see catalog JSDoc, simplification 2).
   */
  task: 1.0,
  /**
   * Derived as `0.85^(1/14)` for `turn (period=14d)`.
   * Source: docs/05-memoria-decay.md §2 row "turn".
   *
   * Exact value: 0.988458623647138... → rounded to 0.988459.
   */
  turn: 0.988459,
});

/**
 * Severity-specific overrides applied when the kind is `learning`.
 * Mirrors the "severity afecta decay" rule in
 * `docs/03-modelo-datos.md` §4.4 / `docs/05-memoria-decay.md` §2:
 * - `tip`: normal decay (period 30d, factor 0.95 per period).
 * - `warning`: slower decay (period 60d, factor 0.97 per period).
 * - `critical`: no decay (`period=∞`, factor 1.0).
 *
 * Each multiplier is the per-day daily multiplier derived from the
 * per-period factor / period documented in the spec table — see the
 * `DEFAULT_DECAY_FACTORS_PER_DAY` JSDoc for the calibration formula
 * and rationale. Values are rounded to six decimals.
 */
const LEARNING_DECAY_FACTORS_PER_DAY: Readonly<
  Record<ReturnType<LearningSeverity["toString"]>, number>
> = Object.freeze({
  /**
   * Derived as `0.95^(1/30)` for `learning (severity=tip, period=30d)`.
   * Source: docs/05-memoria-decay.md §2 row "learning (tip)".
   *
   * Exact value: 0.998291684355534... → rounded to 0.998292.
   */
  tip: 0.998292,
  /**
   * Derived as `0.97^(1/60)` for `learning (severity=warning, period=60d)`.
   * Source: docs/05-memoria-decay.md §2 row "learning (warning)".
   *
   * Exact value: 0.999492475376136... → rounded to 0.999492.
   */
  warning: 0.999492,
  /**
   * No-decay sentinel for `learning (severity=critical)`. Source:
   * docs/05-memoria-decay.md §2 row "learning (critical)"
   * (`factor=1.0, period=∞`). Critical learnings always surface if
   * relevant — the curator MUST NOT erode their confidence over time.
   */
  critical: 1.0,
});

/**
 * Value object representing a decay multiplier applied per "decay
 * period" (per day, in the curator's MVP normalisation).
 *
 * The curator's decay model is geometric multiplication:
 *
 *     new_confidence = current_confidence * (decay_factor ^ days_elapsed)
 *
 * (See `docs/05-memoria-decay.md` §2.) This VO encapsulates the
 * factor and exposes the per-kind / per-severity defaults from the
 * spec catalog so callers cannot accidentally hard-code a magic
 * number.
 *
 * Invariants:
 * - The wrapped value is a finite number in the half-open interval
 *   `(0, 1]`. Zero would erase confidence in one tick (defeating the
 *   "soft forgetting" model); values above one would *boost*
 *   confidence over time, which is not a decay at all.
 * - Instances are immutable.
 *
 * Equality:
 * - Two `DecayFactor` are equal iff their numeric values are equal
 *   (exact floating-point comparison; if you need fuzzy comparison,
 *   compute it explicitly).
 */
export class DecayFactor {
  private constructor(public readonly value: number) {}

  /**
   * Builds a `DecayFactor` from a raw numeric value in `(0, 1]`.
   */
  public static of(value: number): DecayFactor {
    if (!Number.isFinite(value)) {
      throw new InvalidDecayFactorError(value);
    }
    if (value <= 0 || value > 1) {
      throw new InvalidDecayFactorError(value);
    }
    return new DecayFactor(value);
  }

  /**
   * Returns the per-day default decay factor for the given kind. When
   * `kind === "learning"`, the optional `severity` selects the
   * severity-specific override; passing `null` (or omitting the
   * argument) collapses to the kind-level default.
   *
   * The factory is the canonical source of decay defaults. Callers
   * MUST go through it instead of reaching into the literal tables,
   * so the catalog can evolve in one place.
   */
  public static forKind(
    kind: MemoryEntryKind,
    severity: LearningSeverity | null,
  ): DecayFactor {
    if (kind.isLearning() && severity !== null) {
      const override = LEARNING_DECAY_FACTORS_PER_DAY[severity.toString()];
      return DecayFactor.of(override);
    }
    const fallback = DEFAULT_DECAY_FACTORS_PER_DAY[kind.toString()];
    return DecayFactor.of(fallback);
  }

  /**
   * Convenience factory for the "no decay" sentinel (`factor = 1`).
   * Used by the catalog for `task` and `learning (critical)`.
   */
  public static unity(): DecayFactor {
    return new DecayFactor(1);
  }

  /**
   * True when the factor leaves the value untouched (`value === 1`).
   * Lets the calculator skip the `Math.pow` step when no decay would
   * be applied.
   */
  public isUnity(): boolean {
    return this.value === 1;
  }

  public toNumber(): number {
    return this.value;
  }

  public equals(other: DecayFactor): boolean {
    return this.value === other.value;
  }
}
