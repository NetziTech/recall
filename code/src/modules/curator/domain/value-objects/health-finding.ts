import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";
import type { AffectedEntryRef } from "./affected-entry-ref.ts";
import type { HealthFindingKind } from "./health-finding-kind.ts";
import type { HealthSeverity } from "./health-severity.ts";

/**
 * Maximum length of a finding `description`. Findings are short
 * human-readable strings ("path '/old.ts' no longer exists",
 * "decision 'use Postgres' contradicts 'use SQLite'"); allowing more
 * than 2000 characters would let arbitrary text bloat the
 * `curator_runs` audit trail.
 */
const MAX_DESCRIPTION_LENGTH = 2000;

/**
 * Value object capturing a single self-healing finding produced by a
 * curator run.
 *
 * Mirrors the four self-healing checks documented in
 * `docs/05-memoria-decay.md` §5 (`path stale`, `decision conflict`,
 * `embedding queue stuck`, `open question aging`). The aggregate
 * `CuratorRun` accumulates a list of findings throughout the pass;
 * the application layer drains them after persistence and surfaces
 * them via the `mem.curator_run` response (when `trigger === manual`)
 * or via the structured logger (otherwise).
 *
 * Invariants:
 * - `affectedEntries` is a frozen, possibly-empty list of
 *   `AffectedEntryRef`. The list MAY be empty for findings that
 *   describe a global condition (e.g. a queue-wide problem rather
 *   than a per-row issue), but typical findings carry one or two
 *   refs.
 * - `description` is a non-empty trimmed string no longer than
 *   `MAX_DESCRIPTION_LENGTH`.
 * - Instances are immutable.
 *
 * Equality:
 * - Two findings are equal iff their kind, severity, description and
 *   the ordered `affectedEntries` list match element-by-element.
 */
export class HealthFinding {
  private constructor(
    public readonly kind: HealthFindingKind,
    public readonly severity: HealthSeverity,
    public readonly description: string,
    public readonly affectedEntries: readonly AffectedEntryRef[],
  ) {}

  /**
   * Builds a `HealthFinding`. Trims `description`, validates length,
   * and freezes `affectedEntries`.
   */
  public static create(input: {
    kind: HealthFindingKind;
    severity: HealthSeverity;
    description: string;
    affectedEntries: readonly AffectedEntryRef[];
  }): HealthFinding {
    if (typeof input.description !== "string") {
      throw new InvalidInputError("finding description must be a string", {
        field: "description",
      });
    }
    const trimmed = input.description.trim();
    if (trimmed.length === 0) {
      throw new InvalidInputError(
        "finding description must contain at least one non-whitespace character",
        { field: "description" },
      );
    }
    if (trimmed.length > MAX_DESCRIPTION_LENGTH) {
      throw new InvalidInputError(
        `finding description must be at most ${String(MAX_DESCRIPTION_LENGTH)} characters (got: ${String(trimmed.length)})`,
        { field: "description" },
      );
    }
    return new HealthFinding(
      input.kind,
      input.severity,
      trimmed,
      Object.freeze([...input.affectedEntries]),
    );
  }

  public equals(other: HealthFinding): boolean {
    if (this === other) return true;
    if (!this.kind.equals(other.kind)) return false;
    if (!this.severity.equals(other.severity)) return false;
    if (this.description !== other.description) return false;
    if (this.affectedEntries.length !== other.affectedEntries.length) {
      return false;
    }
    for (let i = 0; i < this.affectedEntries.length; i += 1) {
      const left = this.affectedEntries[i];
      const right = other.affectedEntries[i];
      if (left === undefined || right === undefined) return false;
      if (!left.equals(right)) return false;
    }
    return true;
  }
}
