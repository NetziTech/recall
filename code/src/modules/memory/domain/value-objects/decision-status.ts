import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";

/**
 * Set of legal `DecisionStatusKind` values. Single source of truth for
 * the union below — adding a new status is a one-line change here.
 *
 * Per `docs/03-modelo-datos.md` §4.3, a decision is "active" while
 * `superseded_by IS NULL` and "superseded" once the column is set. The
 * domain models that bit explicitly so the recall layer never has to
 * reason about NULL semantics.
 */
const DECISION_STATUS_KINDS = ["active", "superseded"] as const;

export type DecisionStatusKind = (typeof DECISION_STATUS_KINDS)[number];

/**
 * Value object representing the lifecycle status of a `Decision`.
 *
 * Decisions never get deleted; instead, an obsolete one is "superseded"
 * by a newer one (`docs/03-modelo-datos.md` §4.3 — "Regla: decisions con
 * `superseded_by IS NOT NULL` se excluyen de `mem.recall` por default").
 * The status is the projection of that bit into the domain.
 *
 * Invariants:
 * - The wrapped `kind` is always one of `"active" | "superseded"`.
 * - Instances are immutable. Status changes happen at the aggregate
 *   level (`Decision.supersede(...)`) and produce a new VO; this class
 *   never mutates in place.
 *
 * Equality:
 * - Two `DecisionStatus` are equal iff they share the same `kind`.
 */
export class DecisionStatus {
  private constructor(public readonly kind: DecisionStatusKind) {}

  /**
   * Convenience factory for the default `active` status.
   */
  public static active(): DecisionStatus {
    return new DecisionStatus("active");
  }

  /**
   * Convenience factory for the `superseded` status.
   */
  public static superseded(): DecisionStatus {
    return new DecisionStatus("superseded");
  }

  /**
   * Builds a `DecisionStatus` from a raw string. Used when reading from
   * persistence or decoding JSON-RPC arguments. Whitespace is tolerated
   * (trimmed) but case is significant.
   */
  public static create(raw: string): DecisionStatus {
    if (typeof raw !== "string") {
      throw new InvalidInputError("decision status must be a string", {
        field: "status",
      });
    }
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      throw new InvalidInputError("decision status must not be empty", {
        field: "status",
      });
    }
    if (!DecisionStatus.isKind(trimmed)) {
      throw new InvalidInputError(
        `decision status must be one of "active" | "superseded" (got: "${raw}")`,
        { field: "status" },
      );
    }
    return new DecisionStatus(trimmed);
  }

  /**
   * Type guard exposed for callers that need to validate raw strings
   * without instantiating the VO.
   */
  public static isKind(candidate: string): candidate is DecisionStatusKind {
    for (const known of DECISION_STATUS_KINDS) {
      if (known === candidate) return true;
    }
    return false;
  }

  public isActive(): boolean {
    return this.kind === "active";
  }

  public isSuperseded(): boolean {
    return this.kind === "superseded";
  }

  public toString(): DecisionStatusKind {
    return this.kind;
  }

  public equals(other: DecisionStatus): boolean {
    return this.kind === other.kind;
  }
}
