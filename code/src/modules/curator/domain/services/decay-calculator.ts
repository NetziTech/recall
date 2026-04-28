import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";
import { Confidence } from "../../../../shared/domain/value-objects/confidence.ts";
import type { LearningSeverity } from "../../../memory/domain/value-objects/learning-severity.ts";
import { DecayFactor } from "../value-objects/decay-factor.ts";
import type { MemoryEntryKind } from "../value-objects/memory-entry-kind.ts";

/**
 * Pure domain service that codifies the geometric-decay formula
 * documented in `docs/05-memoria-decay.md` §2.
 *
 * Given a current `Confidence`, the number of days that have elapsed
 * since the entry was last surfaced, and a kind / severity pair that
 * selects the per-kind decay factor, the calculator returns the new
 * `Confidence` after decay:
 *
 *     new = current * (factor ^ days_since_last_used)
 *
 * The service is *pure* — it has no I/O, no clock, no state. The
 * curator's application layer typically calls
 * `DecayCalculator.newConfidence(...)` once per entry during the
 * decay pass. Because the calculation lives in the domain, it can be
 * exercised by unit tests without any infrastructure.
 *
 * Why a static-only class instead of free functions:
 * - Mirrors the rest of the codebase's domain services
 *   (`SecretsScanner` is an interface; `KeyValidator` is an
 *   interface; pure-logic services like this one stay class-static).
 * - Lets the caller import a single symbol that namespaces the helpers.
 * - The class is intentionally `final` (cannot be subclassed) by
 *   marking the constructor private — the calculator's behaviour is
 *   the *one* algorithm in `docs/05-memoria-decay.md` §2 and there is
 *   no extension point.
 */
// `no-extraneous-class` would prefer either free functions or a plain
// object, but the DDD-validator (`phase-1-task-9-ddd-validator.md`,
// "Decisión #1") explicitly approves the static-only class as the
// idiomatic TypeScript spelling of a "namespace of pure functions" for
// a domain service. The single symbol `DecayCalculator` carries the
// name of the algorithm in the ubiquitous language, and the
// `private constructor` keeps the class effectively final.
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class DecayCalculator {
  private constructor() {
    // Static-only class.
  }

  /**
   * Computes the new confidence after decay.
   *
   * Inputs:
   * - `current`: the entry's current `Confidence`.
   * - `daysSinceLastUsed`: a non-negative finite number. Fractional
   *   days are accepted (the curator may run mid-day; the elapsed
   *   delta in milliseconds divides cleanly into a real-valued day
   *   count). Zero days means the calculator returns the input
   *   unchanged.
   * - `kind`: the kind of memory entry being decayed.
   * - `severity`: an optional `LearningSeverity` that overrides the
   *   default factor when `kind === "learning"`. Pass `null` for
   *   any other kind, or for learnings whose severity should not
   *   influence the factor (in practice always pass it for
   *   learnings; the optional shape mirrors the schema's nullable
   *   column).
   *
   * The factor used for the calculation is selected through
   * `DecayFactor.forKind(kind, severity)`, which is the canonical
   * source of decay defaults.
   *
   * Edge cases:
   * - When the factor is unity (e.g. `task` or
   *   `learning (critical)`), the calculation short-circuits and
   *   returns the input unchanged. This avoids an unnecessary
   *   `Math.pow` call and guarantees bit-identical output for
   *   no-decay kinds.
   * - When `daysSinceLastUsed === 0`, the calculation also
   *   short-circuits (`factor ^ 0 = 1`).
   * - The result is always a valid `Confidence` (`Confidence.of`
   *   re-validates the [0, 1] interval — multiplying a value in
   *   [0, 1] by a value in (0, 1] keeps it in [0, 1] by
   *   construction).
   */
  public static newConfidence(input: {
    current: Confidence;
    daysSinceLastUsed: number;
    kind: MemoryEntryKind;
    severity: LearningSeverity | null;
  }): Confidence {
    if (!Number.isFinite(input.daysSinceLastUsed)) {
      throw new InvalidInputError(
        "days since last used must be a finite number",
        { field: "days_since_last_used" },
      );
    }
    if (input.daysSinceLastUsed < 0) {
      throw new InvalidInputError(
        "days since last used must be non-negative",
        { field: "days_since_last_used" },
      );
    }

    const factor = DecayFactor.forKind(input.kind, input.severity);
    if (factor.isUnity() || input.daysSinceLastUsed === 0) {
      return input.current;
    }

    const decayed = input.current.toNumber() *
      Math.pow(factor.toNumber(), input.daysSinceLastUsed);
    // `Math.pow(factor in (0, 1], days >= 0)` stays in (0, 1].
    // Multiplying a Confidence (in [0, 1]) by a value in (0, 1] stays
    // in [0, 1]. We still go through `Confidence.of` so the invariant
    // is enforced structurally rather than relying on the math.
    return Confidence.of(decayed);
  }
}
