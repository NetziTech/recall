import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";

/**
 * Maximum length, in characters, of a single file path entry. Generous
 * enough to fit deeply-nested monorepo paths but bounded so a malformed
 * value cannot inflate the JSON column unboundedly.
 */
const MAX_FILE_PATH_LENGTH = 4000;

/**
 * Value object representing the list of file paths touched during a
 * `Turn`.
 *
 * Mirrors the `turns.files_touched_json TEXT NOT NULL DEFAULT '[]'`
 * column documented in `docs/03-modelo-datos.md` §4.2. The persistence
 * layer serialises the list as a JSON array; the domain keeps it as a
 * dedicated VO so the (de-duplicated, non-empty-paths) invariants are
 * enforced in one place, and so callers cannot accidentally hand a
 * mutable array to the aggregate.
 *
 * Invariants:
 * - Each path is a non-empty string after trimming.
 * - No duplicate paths (after trimming, case-sensitive comparison —
 *   filesystems can be case-sensitive, which is the safe default).
 * - Each path is at most `MAX_FILE_PATH_LENGTH` characters.
 * - The internal array is frozen and never mutated; mutation operations
 *   would return a new instance, but the curent surface is read-only.
 *
 * Equality:
 * - Two `FilesTouched` are equal iff they contain the same paths in
 *   the same order. The ordering matters because tools tend to surface
 *   files in the order they were edited and that ordering is part of
 *   the user-facing rendering.
 */
export class FilesTouched {
  private constructor(private readonly values: readonly string[]) {}

  /**
   * Empty `FilesTouched` instance. Returned when the persistence
   * default (`'[]'`) round-trips into the aggregate.
   */
  public static empty(): FilesTouched {
    return new FilesTouched(Object.freeze([]));
  }

  /**
   * Builds a `FilesTouched` instance from a raw array. Validates
   * non-emptiness of each entry, length cap, and global uniqueness.
   */
  public static create(raw: readonly string[]): FilesTouched {
    const normalised: string[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < raw.length; i += 1) {
      const candidate = raw[i];
      if (typeof candidate !== "string") {
        throw new InvalidInputError(
          `files_touched[${String(i)}] must be a string`,
          { field: `files_touched[${String(i)}]` },
        );
      }
      const trimmed = candidate.trim();
      if (trimmed.length === 0) {
        throw new InvalidInputError(
          `files_touched[${String(i)}] must contain at least one non-whitespace character`,
          { field: `files_touched[${String(i)}]` },
        );
      }
      if (trimmed.length > MAX_FILE_PATH_LENGTH) {
        throw new InvalidInputError(
          `files_touched[${String(i)}] must be at most ${String(MAX_FILE_PATH_LENGTH)} characters (got: ${String(trimmed.length)})`,
          { field: `files_touched[${String(i)}]` },
        );
      }
      if (seen.has(trimmed)) {
        throw new InvalidInputError(
          `duplicate path in files_touched: "${trimmed}"`,
          { field: `files_touched[${String(i)}]` },
        );
      }
      seen.add(trimmed);
      normalised.push(trimmed);
    }
    return new FilesTouched(Object.freeze(normalised));
  }

  public size(): number {
    return this.values.length;
  }

  public isEmpty(): boolean {
    return this.values.length === 0;
  }

  public contains(path: string): boolean {
    return this.values.includes(path.trim());
  }

  /**
   * Returns the paths as a frozen, read-only array. Callers must not
   * cast the result to a mutable array.
   */
  public toArray(): readonly string[] {
    return this.values;
  }

  public equals(other: FilesTouched): boolean {
    if (this === other) return true;
    if (this.values.length !== other.values.length) return false;
    for (let i = 0; i < this.values.length; i += 1) {
      if (this.values[i] !== other.values[i]) return false;
    }
    return true;
  }
}
