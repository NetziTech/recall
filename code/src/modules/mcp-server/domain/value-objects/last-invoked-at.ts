import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";

/**
 * Discriminated union representing the "moment a tool was last
 * invoked" state. Two cases:
 * - `never`: the tool has been registered but never called yet. The
 *   `at` slot is `null`.
 * - `at`: the tool was called at the supplied `Timestamp`.
 *
 * Why not a plain `Timestamp | null`:
 * - The `null` case carries semantic weight ("never used yet" is not
 *   the same as "missing data"). The discriminator forces callers to
 *   handle the never branch explicitly instead of papering over it
 *   with an epoch-zero sentinel.
 *
 * Mirrors the `LastUsed` VO from the `memory` module conceptually
 * (same union shape, same `touch(at)` ergonomics) but lives here as
 * a sibling because the bounded contexts differ — see the rationale
 * in `invocation-count.ts`.
 */
export type LastInvokedAtValue =
  | { readonly kind: "never"; readonly at: null }
  | { readonly kind: "at"; readonly at: Timestamp };

/**
 * Value object representing the moment a tool was last invoked.
 *
 * Used by `ToolRegistration` to keep the registry's per-tool
 * bookkeeping fresh. Recall scoring is NOT involved here (that lives
 * in the `retrieval` / `curator` modules over memory entries); this
 * is purely operational data ("which tools are warm right now?").
 *
 * Invariants:
 * - When `kind === "never"`, `at` is `null`.
 * - When `kind === "at"`, `at` is a non-null `Timestamp`.
 * - Instances are immutable; mutation produces a new VO.
 */
export class LastInvokedAt {
  private constructor(
    public readonly kind: "never" | "at",
    public readonly at: Timestamp | null,
  ) {}

  /**
   * No invocation has been recorded yet.
   */
  public static never(): LastInvokedAt {
    return new LastInvokedAt("never", null);
  }

  /**
   * Pins the last-invoked moment to a concrete timestamp.
   */
  public static at(at: Timestamp): LastInvokedAt {
    return new LastInvokedAt("at", at);
  }

  /**
   * Returns a new `LastInvokedAt` updated to the supplied moment.
   * Always produces a `kind: "at"` VO regardless of the previous
   * state.
   */
  public touch(at: Timestamp): LastInvokedAt {
    return new LastInvokedAt("at", at);
  }

  /**
   * Computes how many milliseconds elapsed between `now` and the
   * last invocation. Returns `null` when no invocation has been
   * recorded — callers must handle that case explicitly so they do
   * not silently treat "never used" as "used at the epoch".
   */
  public millisecondsSince(now: Timestamp): number | null {
    if (this.at === null) return null;
    const delta = now.diff(this.at);
    return delta < 0 ? 0 : delta;
  }

  public hasBeenInvoked(): boolean {
    return this.kind === "at";
  }

  /**
   * Returns the discriminated-union view. Useful for adapters that
   * need to pattern-match without poking at the class internals.
   */
  public toValue(): LastInvokedAtValue {
    if (this.kind === "at" && this.at !== null) {
      return { kind: "at", at: this.at };
    }
    return { kind: "never", at: null };
  }

  public equals(other: LastInvokedAt): boolean {
    if (this === other) return true;
    if (this.kind !== other.kind) return false;
    if (this.at === null && other.at === null) return true;
    if (this.at === null || other.at === null) return false;
    return this.at.equals(other.at);
  }
}
