import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";

/**
 * Set of legal `HealthSeverityKind` values. Single source of truth for
 * the union below.
 *
 * The three-level scale mirrors the typical `info | warning | error`
 * triage used by infrastructure logging adapters and matches the
 * intent of `docs/05-memoria-decay.md` §5: most findings are
 * informational (an open question aged, a path went stale and was
 * tagged), some are warnings (an embedding queue stuck on retries),
 * and a few are errors (a decision conflict the user must resolve
 * manually).
 */
const HEALTH_SEVERITIES = ["info", "warning", "error"] as const;

export type HealthSeverityKind = (typeof HEALTH_SEVERITIES)[number];

/**
 * Numeric ordering used to compare severities. Higher value = more
 * severe. The mapping is internal to the VO so callers cannot drift
 * from it.
 */
const SEVERITY_RANK: Readonly<Record<HealthSeverityKind, number>> =
  Object.freeze({
    info: 0,
    warning: 1,
    error: 2,
  });

/**
 * Value object representing the triage level of a `HealthFinding`.
 *
 * Invariants:
 * - The wrapped `kind` is one of the three known values.
 * - Instances are immutable.
 */
export class HealthSeverity {
  private constructor(public readonly kind: HealthSeverityKind) {}

  public static info(): HealthSeverity {
    return new HealthSeverity("info");
  }

  public static warning(): HealthSeverity {
    return new HealthSeverity("warning");
  }

  public static error(): HealthSeverity {
    return new HealthSeverity("error");
  }

  public static create(raw: string): HealthSeverity {
    if (typeof raw !== "string") {
      throw new InvalidInputError("health severity must be a string", {
        field: "severity",
      });
    }
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      throw new InvalidInputError("health severity must not be empty", {
        field: "severity",
      });
    }
    if (!HealthSeverity.isKind(trimmed)) {
      throw new InvalidInputError(
        `health severity must be one of "info" | "warning" | "error" (got: "${raw}")`,
        { field: "severity" },
      );
    }
    return new HealthSeverity(trimmed);
  }

  public static isKind(candidate: string): candidate is HealthSeverityKind {
    for (const known of HEALTH_SEVERITIES) {
      if (known === candidate) return true;
    }
    return false;
  }

  /**
   * Returns a numeric rank that grows with severity.
   */
  public rank(): number {
    return SEVERITY_RANK[this.kind];
  }

  /**
   * True iff this severity is at least as severe as `other`.
   */
  public isAtLeast(other: HealthSeverity): boolean {
    return this.rank() >= other.rank();
  }

  public isInfo(): boolean {
    return this.kind === "info";
  }

  public isWarning(): boolean {
    return this.kind === "warning";
  }

  public isError(): boolean {
    return this.kind === "error";
  }

  public toString(): HealthSeverityKind {
    return this.kind;
  }

  public equals(other: HealthSeverity): boolean {
    return this.kind === other.kind;
  }
}
