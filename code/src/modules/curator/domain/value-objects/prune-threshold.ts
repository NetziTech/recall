import type { Confidence } from "../../../../shared/domain/value-objects/confidence.ts";
import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";

/**
 * Default confidence threshold below which an entry becomes a
 * pruning candidate. Mirrors `confidence < 0.1` in
 * `docs/05-memoria-decay.md` §4.
 */
const DEFAULT_PRUNE_THRESHOLD = 0.1;

/**
 * Value object representing the confidence threshold used by the
 * curator's pruning pass.
 *
 * An entry whose `Confidence` is *strictly below* this threshold is a
 * pruning candidate. Pruned entries move to the `pruned` table for
 * audit (`docs/05-memoria-decay.md` §4 — "Pruning preserva audit
 * trail") and stay there for 30 days before being deleted physically.
 *
 * Invariants:
 * - The wrapped value is a finite number in the closed interval
 *   `[0, 1]` (it shares the `Confidence` co-domain).
 * - Instances are immutable.
 *
 * Equality:
 * - Two `PruneThreshold` are equal iff their numeric values are
 *   exactly equal.
 */
export class PruneThreshold {
  private constructor(public readonly value: number) {}

  /**
   * Default threshold (`0.1`, per `docs/05-memoria-decay.md` §4).
   */
  public static default(): PruneThreshold {
    return new PruneThreshold(DEFAULT_PRUNE_THRESHOLD);
  }

  /**
   * Builds a `PruneThreshold` from a raw numeric value in `[0, 1]`.
   */
  public static of(value: number): PruneThreshold {
    if (!Number.isFinite(value)) {
      throw new InvalidInputError("prune threshold must be a finite number", {
        field: "prune_threshold",
      });
    }
    if (value < 0 || value > 1) {
      throw new InvalidInputError(
        `prune threshold must be in the closed interval [0, 1] (got: ${String(value)})`,
        { field: "prune_threshold" },
      );
    }
    return new PruneThreshold(value);
  }

  /**
   * True iff the supplied confidence is below this threshold (and
   * therefore the entry qualifies for pruning).
   */
  public qualifies(confidence: Confidence): boolean {
    return confidence.toNumber() < this.value;
  }

  public toNumber(): number {
    return this.value;
  }

  public equals(other: PruneThreshold): boolean {
    return this.value === other.value;
  }
}
