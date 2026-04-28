import { InvalidInputError } from "../errors/invalid-input-error.ts";

/**
 * Value object representing a point in time as the number of
 * milliseconds elapsed since the UNIX epoch (UTC).
 *
 * The whole codebase uses `epoch_ms` as the canonical wire format for
 * timestamps (see `docs/03-modelo-datos.md` §2 and §4: every persisted
 * `*_at_ms` column is an integer millisecond count). `Timestamp` is the
 * single in-memory representation and the only place where the
 * arithmetic over time happens.
 *
 * Invariants:
 * - `epochMs` is a finite, non-negative integer. Negative or fractional
 *   values are rejected at construction.
 * - Instances are immutable. Operations like `add`, `subtract` produce
 *   a new `Timestamp`.
 * - Equality is defined by the millisecond value; the source `Date` is
 *   irrelevant.
 *
 * Note on dependencies:
 * - The factory `now(clockMs)` requires the current time as a parameter
 *   so that the domain stays free of `Date.now()` calls. The
 *   composition root injects a `Clock` port that supplies the value.
 */
export class Timestamp {
  private constructor(public readonly epochMs: number) {}

  /**
   * Builds a `Timestamp` from an explicit millisecond count.
   */
  public static fromEpochMs(epochMs: number): Timestamp {
    if (!Number.isFinite(epochMs)) {
      throw new InvalidInputError(
        "timestamp must be a finite number of milliseconds",
        { field: "epochMs" },
      );
    }
    if (!Number.isInteger(epochMs)) {
      throw new InvalidInputError(
        "timestamp must be an integer number of milliseconds",
        { field: "epochMs" },
      );
    }
    if (epochMs < 0) {
      throw new InvalidInputError(
        "timestamp must be non-negative (epoch is the lower bound)",
        { field: "epochMs" },
      );
    }
    return new Timestamp(epochMs);
  }

  /**
   * Builds a `Timestamp` from a `Date`. The current implementation only
   * accepts dates whose `getTime()` is a non-negative integer; invalid
   * dates (`NaN`) are rejected.
   */
  public static fromDate(date: Date): Timestamp {
    return Timestamp.fromEpochMs(date.getTime());
  }

  /**
   * Builds a `Timestamp` for "now" given the current epoch milliseconds
   * supplied by an external clock. The domain never reads the system
   * clock directly.
   */
  public static now(clockMs: number): Timestamp {
    return Timestamp.fromEpochMs(clockMs);
  }

  /**
   * Difference, in milliseconds, between this timestamp and `other`.
   * The result is `this - other`: positive if `this` is later.
   */
  public diff(other: Timestamp): number {
    return this.epochMs - other.epochMs;
  }

  /**
   * Difference, in absolute milliseconds, between this timestamp and
   * `other`. Always non-negative.
   */
  public absoluteDiff(other: Timestamp): number {
    const delta = this.epochMs - other.epochMs;
    return delta < 0 ? -delta : delta;
  }

  public isAfter(other: Timestamp): boolean {
    return this.epochMs > other.epochMs;
  }

  public isBefore(other: Timestamp): boolean {
    return this.epochMs < other.epochMs;
  }

  public isSameInstantAs(other: Timestamp): boolean {
    return this.epochMs === other.epochMs;
  }

  /**
   * Returns a new `Timestamp` shifted by `deltaMs` milliseconds.
   * `deltaMs` must keep the result non-negative.
   */
  public add(deltaMs: number): Timestamp {
    return Timestamp.fromEpochMs(this.epochMs + deltaMs);
  }

  /**
   * Returns a new `Timestamp` shifted backwards by `deltaMs`
   * milliseconds. The result must remain non-negative.
   */
  public subtract(deltaMs: number): Timestamp {
    return Timestamp.fromEpochMs(this.epochMs - deltaMs);
  }

  public toDate(): Date {
    return new Date(this.epochMs);
  }

  public toEpochMs(): number {
    return this.epochMs;
  }

  public equals(other: Timestamp): boolean {
    return this.epochMs === other.epochMs;
  }
}
