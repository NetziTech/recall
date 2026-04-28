import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";

/**
 * Set of legal `PrunedReasonKind` values. Single source of truth for
 * the union below.
 *
 * Mirrors the `pruned.reason TEXT` column documented in
 * `docs/03-modelo-datos.md` §4.9 and the wider pruning policy in
 * `docs/05-memoria-decay.md` §4 and §8 ("`mem.forget`").
 *
 * - `low_confidence`: the curator's pruning pass moved the entry
 *   because its confidence dropped below `PruneThreshold` (and it
 *   met the other criteria documented in §4 — `use_count == 0`,
 *   `created_at > 30 days`).
 * - `manual`: the user explicitly forgot the entry via `mem.forget`
 *   (`docs/05-memoria-decay.md` §8).
 * - `consolidated_into_other`: a learning was folded into another by
 *   the consolidation pass (§3) and is being archived for the audit
 *   trail.
 * - `obsoleted`: the curator marked the entry as no longer
 *   applicable (e.g. an `Entity` whose path went stale and exhausted
 *   its grace period).
 */
const PRUNED_REASONS = [
  "low_confidence",
  "manual",
  "consolidated_into_other",
  "obsoleted",
] as const;

export type PrunedReasonKind = (typeof PRUNED_REASONS)[number];

/**
 * Value object naming the reason a memory entry was pruned.
 *
 * Persisted in the `pruned` table so the audit trail explains *why*
 * each entry was removed (per `docs/05-memoria-decay.md` §4 —
 * "Pruning preserva audit trail").
 *
 * Invariants:
 * - The wrapped `kind` is always one of the four known values.
 * - Instances are immutable.
 */
export class PrunedReason {
  private constructor(public readonly kind: PrunedReasonKind) {}

  public static lowConfidence(): PrunedReason {
    return new PrunedReason("low_confidence");
  }

  public static manual(): PrunedReason {
    return new PrunedReason("manual");
  }

  public static consolidatedIntoOther(): PrunedReason {
    return new PrunedReason("consolidated_into_other");
  }

  public static obsoleted(): PrunedReason {
    return new PrunedReason("obsoleted");
  }

  public static create(raw: string): PrunedReason {
    if (typeof raw !== "string") {
      throw new InvalidInputError("pruned reason must be a string", {
        field: "reason",
      });
    }
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      throw new InvalidInputError("pruned reason must not be empty", {
        field: "reason",
      });
    }
    if (!PrunedReason.isKind(trimmed)) {
      throw new InvalidInputError(
        `pruned reason must be one of "low_confidence" | "manual" | "consolidated_into_other" | "obsoleted" (got: "${raw}")`,
        { field: "reason" },
      );
    }
    return new PrunedReason(trimmed);
  }

  public static isKind(candidate: string): candidate is PrunedReasonKind {
    for (const known of PRUNED_REASONS) {
      if (known === candidate) return true;
    }
    return false;
  }

  public toString(): PrunedReasonKind {
    return this.kind;
  }

  public equals(other: PrunedReason): boolean {
    return this.kind === other.kind;
  }
}
