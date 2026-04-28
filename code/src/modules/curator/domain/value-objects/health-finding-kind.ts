import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";

/**
 * Set of legal `HealthFindingKindKind` values. Single source of truth
 * for the union below.
 *
 * Mirrors the four self-healing buckets in
 * `docs/05-memoria-decay.md` §5:
 * - `path_stale`: an `Entity.location` that no longer exists on disk
 *   (Caso 1).
 * - `decision_conflict`: two active decisions with the same scope/
 *   module but contradictory rationales (Caso 2).
 * - `embedding_drift`: an entry whose `embedding_queue` row has
 *   exhausted its retries (Caso 5) or whose vector dimension differs
 *   from the active embedder model.
 * - `open_question_aging`: an open question that has not been touched
 *   for more than three sessions (Caso 3).
 */
const HEALTH_FINDING_KINDS = [
  "path_stale",
  "decision_conflict",
  "embedding_drift",
  "open_question_aging",
] as const;

export type HealthFindingKindKind = (typeof HEALTH_FINDING_KINDS)[number];

/**
 * Value object discriminating the kind of issue a `HealthFinding`
 * reports.
 *
 * Invariants:
 * - The wrapped `kind` is always one of the four known values.
 * - Instances are immutable.
 */
export class HealthFindingKind {
  private constructor(public readonly kind: HealthFindingKindKind) {}

  public static pathStale(): HealthFindingKind {
    return new HealthFindingKind("path_stale");
  }

  public static decisionConflict(): HealthFindingKind {
    return new HealthFindingKind("decision_conflict");
  }

  public static embeddingDrift(): HealthFindingKind {
    return new HealthFindingKind("embedding_drift");
  }

  public static openQuestionAging(): HealthFindingKind {
    return new HealthFindingKind("open_question_aging");
  }

  public static create(raw: string): HealthFindingKind {
    if (typeof raw !== "string") {
      throw new InvalidInputError("health finding kind must be a string", {
        field: "finding_kind",
      });
    }
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      throw new InvalidInputError("health finding kind must not be empty", {
        field: "finding_kind",
      });
    }
    if (!HealthFindingKind.isKind(trimmed)) {
      throw new InvalidInputError(
        `health finding kind must be one of "path_stale" | "decision_conflict" | "embedding_drift" | "open_question_aging" (got: "${raw}")`,
        { field: "finding_kind" },
      );
    }
    return new HealthFindingKind(trimmed);
  }

  public static isKind(candidate: string): candidate is HealthFindingKindKind {
    for (const known of HEALTH_FINDING_KINDS) {
      if (known === candidate) return true;
    }
    return false;
  }

  public toString(): HealthFindingKindKind {
    return this.kind;
  }

  public equals(other: HealthFindingKind): boolean {
    return this.kind === other.kind;
  }
}
