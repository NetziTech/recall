import { InvalidInputError } from "../errors/invalid-input-error.ts";

/**
 * Value object representing the set of tags attached to a memory entry.
 *
 * Tags are the primary categorisation mechanism that crosses every
 * persisted kind (`turns.tags_json`, `decisions.tags_json`,
 * `learnings.tags_json`, `entities.tags_json`, `tasks.tags_json` — see
 * `docs/03-modelo-datos.md` §4). The order is preserved so the user-
 * facing rendering matches the order in which the user typed them.
 *
 * Invariants:
 * - Every tag is a non-empty string after trimming. Strings made only
 *   of whitespace are rejected.
 * - No duplicates (case-sensitive comparison on the trimmed value).
 *   Duplicate detection happens after trimming, so `"foo "` and `"foo"`
 *   collide and are rejected.
 * - The internal array is frozen and never mutated; mutating
 *   operations (add/remove) return a new `Tags` instance.
 *
 * Equality:
 * - Two `Tags` instances are equal iff they contain the same tags in
 *   the same order. Order matters because tags are part of the
 *   user-facing presentation.
 */
export class Tags {
  private constructor(private readonly values: readonly string[]) {}

  /**
   * Empty `Tags` instance. Cheap to call; always returns a new
   * instance to keep the immutability story simple (no shared
   * singleton that callers could try to mutate via tricks).
   */
  public static empty(): Tags {
    return new Tags(Object.freeze([]));
  }

  /**
   * Builds a `Tags` instance from a raw array. Validates non-emptiness
   * of each string and global uniqueness.
   */
  public static create(raw: readonly string[]): Tags {
    const normalised: string[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < raw.length; i += 1) {
      const candidate = raw[i];
      if (typeof candidate !== "string") {
        throw new InvalidInputError(
          `tag at index ${String(i)} must be a string`,
          { field: `tags[${String(i)}]` },
        );
      }
      const trimmed = candidate.trim();
      if (trimmed.length === 0) {
        throw new InvalidInputError(
          `tag at index ${String(i)} must contain at least one non-whitespace character`,
          { field: `tags[${String(i)}]` },
        );
      }
      if (seen.has(trimmed)) {
        throw new InvalidInputError(
          `duplicate tag detected: "${trimmed}"`,
          { field: `tags[${String(i)}]` },
        );
      }
      seen.add(trimmed);
      normalised.push(trimmed);
    }
    return new Tags(Object.freeze(normalised));
  }

  public contains(tag: string): boolean {
    const trimmed = tag.trim();
    return this.values.includes(trimmed);
  }

  /**
   * Returns a new `Tags` with `tag` appended. Throws if the tag is
   * empty or already present.
   */
  public add(tag: string): Tags {
    return Tags.create([...this.values, tag]);
  }

  /**
   * Returns a new `Tags` without the given tag. If the tag is not
   * present, returns an equivalent `Tags`.
   */
  public remove(tag: string): Tags {
    const trimmed = tag.trim();
    const filtered = this.values.filter((existing) => existing !== trimmed);
    return new Tags(Object.freeze(filtered));
  }

  public size(): number {
    return this.values.length;
  }

  public isEmpty(): boolean {
    return this.values.length === 0;
  }

  /**
   * Returns the tags as a frozen, read-only array. Callers must not
   * attempt to cast the result to a mutable array.
   */
  public toArray(): readonly string[] {
    return this.values;
  }

  public equals(other: Tags): boolean {
    if (this === other) return true;
    if (this.values.length !== other.values.length) return false;
    for (let i = 0; i < this.values.length; i += 1) {
      if (this.values[i] !== other.values[i]) return false;
    }
    return true;
  }

  /**
   * Returns true if this set of tags contains every tag in `required`.
   * Used by recall filters (`must_have_tags`).
   */
  public includesAll(required: Tags): boolean {
    for (const tag of required.values) {
      if (!this.values.includes(tag)) return false;
    }
    return true;
  }

  /**
   * Returns true if this set of tags shares no element with
   * `forbidden`. Used by recall filters (`must_not_have_tags`).
   */
  public intersectsNoneOf(forbidden: Tags): boolean {
    for (const tag of forbidden.values) {
      if (this.values.includes(tag)) return false;
    }
    return true;
  }
}
