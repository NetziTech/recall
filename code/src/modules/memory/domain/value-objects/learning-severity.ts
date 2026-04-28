import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";

/**
 * Set of legal `LearningSeverityKind` values. Mirrors the `severity`
 * column in `learnings` (`docs/03-modelo-datos.md` §4.4) and the
 * `mem.remember` API (`docs/02-protocolo-mcp.md` §4.4).
 */
const LEARNING_SEVERITY_KINDS = ["tip", "warning", "critical"] as const;

export type LearningSeverityKind = (typeof LEARNING_SEVERITY_KINDS)[number];

/**
 * Numeric ordering used to compare severities. The mapping is internal
 * to the VO so callers cannot drift from it. Higher value = more severe.
 *
 * The exact numeric values are an implementation detail — only the
 * ordering matters. We use `0/1/2` to keep the comparison cheap.
 */
const SEVERITY_RANK: Readonly<Record<LearningSeverityKind, number>> =
  Object.freeze({
    tip: 0,
    warning: 1,
    critical: 2,
  });

/**
 * Value object representing the severity of a `Learning`.
 *
 * Severity affects two downstream behaviours documented in
 * `docs/03-modelo-datos.md` §4.4 ("Severity afecta decay"):
 * - `tip` decays normally;
 * - `warning` decays 50% slower;
 * - `critical` does not decay (always surfaces if relevant).
 *
 * The decay arithmetic itself lives in the curator module; this VO only
 * exposes the kind plus an ordering helper so the application layer can
 * sort or filter without leaking the literal strings.
 *
 * Invariants:
 * - The wrapped `kind` is always one of the three known values.
 * - Instances are immutable.
 */
export class LearningSeverity {
  private constructor(public readonly kind: LearningSeverityKind) {}

  /**
   * Default severity. Matches the `learnings.severity DEFAULT 'tip'`
   * column default.
   */
  public static tip(): LearningSeverity {
    return new LearningSeverity("tip");
  }

  public static warning(): LearningSeverity {
    return new LearningSeverity("warning");
  }

  public static critical(): LearningSeverity {
    return new LearningSeverity("critical");
  }

  /**
   * Builds a `LearningSeverity` from a raw string.
   */
  public static create(raw: string): LearningSeverity {
    if (typeof raw !== "string") {
      throw new InvalidInputError("learning severity must be a string", {
        field: "severity",
      });
    }
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      throw new InvalidInputError("learning severity must not be empty", {
        field: "severity",
      });
    }
    if (!LearningSeverity.isKind(trimmed)) {
      throw new InvalidInputError(
        `learning severity must be one of "tip" | "warning" | "critical" (got: "${raw}")`,
        { field: "severity" },
      );
    }
    return new LearningSeverity(trimmed);
  }

  public static isKind(candidate: string): candidate is LearningSeverityKind {
    for (const known of LEARNING_SEVERITY_KINDS) {
      if (known === candidate) return true;
    }
    return false;
  }

  public isTip(): boolean {
    return this.kind === "tip";
  }

  public isWarning(): boolean {
    return this.kind === "warning";
  }

  public isCritical(): boolean {
    return this.kind === "critical";
  }

  /**
   * Returns a numeric rank that grows with severity. Useful for sorting
   * learnings most-severe-first without exposing the literal strings.
   */
  public rank(): number {
    return SEVERITY_RANK[this.kind];
  }

  /**
   * True iff this severity is at least as severe as `other`.
   */
  public isAtLeast(other: LearningSeverity): boolean {
    return this.rank() >= other.rank();
  }

  public toString(): LearningSeverityKind {
    return this.kind;
  }

  public equals(other: LearningSeverity): boolean {
    return this.kind === other.kind;
  }
}
