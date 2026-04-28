import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";

/**
 * Value object representing the moment a memory entry was last surfaced.
 *
 * Mirrors the `last_used_ms INTEGER NOT NULL` column on every persistent
 * kind (`turns`, `decisions`, `learnings`, `entities` —
 * `docs/03-modelo-datos.md` §4). Used by recall scoring
 * (`docs/01-arquitectura.md` §2.6: `recency_decay`).
 *
 * Why a wrapper rather than a plain `Timestamp | null`:
 * - Adds explicit "never used" semantics so callers do not conflate the
 *   missing-value case with `epoch=0`.
 * - Centralises `touch(at)` so updating the field does not require
 *   callers to remember the right timestamp arithmetic.
 *
 * Persistence note: the column is `NOT NULL`, so adapters typically
 * round-trip "never used" entries by setting `last_used_ms` to the
 * `created_at_ms`. The domain represents that explicitly via `never()`
 * for entries that have not yet been surfaced; the application/
 * persistence layer translates between the two representations.
 *
 * Invariants:
 * - When `kind === "never"`, `at` is `null`.
 * - When `kind === "at"`, `at` is a non-null `Timestamp`.
 * - Instances are immutable; mutation produces a new VO.
 */
export type LastUsedValue =
  | { readonly kind: "never"; readonly at: null }
  | { readonly kind: "at"; readonly at: Timestamp };

export class LastUsed {
  private constructor(
    public readonly kind: "never" | "at",
    public readonly at: Timestamp | null,
  ) {}

  /**
   * No use has been recorded yet.
   */
  public static never(): LastUsed {
    return new LastUsed("never", null);
  }

  /**
   * Pins the last-used moment to a concrete timestamp.
   */
  public static at(at: Timestamp): LastUsed {
    return new LastUsed("at", at);
  }

  /**
   * Returns a new `LastUsed` updated to the supplied moment. Always
   * produces a `kind: "at"` VO regardless of the previous state.
   */
  public touch(at: Timestamp): LastUsed {
    return new LastUsed("at", at);
  }

  /**
   * Computes how many milliseconds elapsed between `now` and the last
   * use. Returns `null` when no use has been recorded — callers must
   * handle that case explicitly so they do not silently treat "never
   * used" as "used at the epoch".
   */
  public millisecondsSince(now: Timestamp): number | null {
    if (this.at === null) return null;
    const delta = now.diff(this.at);
    return delta < 0 ? 0 : delta;
  }

  public hasBeenUsed(): boolean {
    return this.kind === "at";
  }

  /**
   * Returns the discriminated-union view. Useful for adapters that need
   * to pattern-match without poking at the class internals.
   */
  public toValue(): LastUsedValue {
    if (this.kind === "at" && this.at !== null) {
      return { kind: "at", at: this.at };
    }
    return { kind: "never", at: null };
  }

  public equals(other: LastUsed): boolean {
    if (this === other) return true;
    if (this.kind !== other.kind) return false;
    if (this.at === null && other.at === null) return true;
    if (this.at === null || other.at === null) return false;
    return this.at.equals(other.at);
  }
}
