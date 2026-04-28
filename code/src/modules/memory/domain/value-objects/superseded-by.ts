import { DecisionId } from "./decision-id.ts";

/**
 * Value object pointing at the decision that supersedes another one.
 *
 * Mirrors the `decisions.superseded_by TEXT` column documented in
 * `docs/03-modelo-datos.md` §4.3. The aggregate stores it as a
 * dedicated VO (instead of a bare `DecisionId | null`) so that the
 * intent ("this is *the* successor link, not just any decision id")
 * stays visible at the call site and so we can attach helpers later
 * (audit metadata, alternative-rejected linkage, ...).
 *
 * Invariants:
 * - `decisionId` is the id of the decision that REPLACES the holder.
 * - Instances are immutable.
 *
 * Equality:
 * - Two instances are equal iff their target ids are equal.
 */
export class SupersededBy {
  private constructor(public readonly decisionId: DecisionId) {}

  /**
   * Builds a `SupersededBy` pointing at a previously-validated
   * `DecisionId`.
   */
  public static of(decisionId: DecisionId): SupersededBy {
    return new SupersededBy(decisionId);
  }

  /**
   * Convenience factory that validates a raw string into a
   * `DecisionId` first.
   */
  public static fromRaw(raw: string): SupersededBy {
    return new SupersededBy(DecisionId.from(raw));
  }

  public equals(other: SupersededBy): boolean {
    return this.decisionId.equals(other.decisionId);
  }
}
