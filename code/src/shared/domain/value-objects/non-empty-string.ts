import { InvalidInputError } from "../errors/invalid-input-error.ts";

/**
 * Base value object for strings that must contain at least one
 * non-whitespace character.
 *
 * Use this as the parent of any title-, name- or content-like value
 * object that cannot be empty (e.g. `DecisionTitle`, `EntityName`,
 * `LearningContent`). Subclasses can tighten the contract (length caps,
 * forbidden characters, etc.) by overriding `validate` or by performing
 * extra checks before delegating to `super.create`.
 *
 * Invariants:
 * - The wrapped string is trimmed of leading/trailing whitespace at
 *   construction time. The trimmed form is the canonical value.
 * - The trimmed string contains at least one character.
 * - Instances are immutable; mutation produces a new value object.
 *
 * Equality:
 * - Two instances are equal iff their canonical (trimmed) values match
 *   character-for-character AND they share the same concrete subclass.
 *   Mixing subclasses (e.g. `DecisionTitle` vs `EntityName`) returns
 *   `false` even if the underlying text is identical.
 */
export class NonEmptyString {
  protected constructor(protected readonly value: string) {}

  /**
   * Generic factory used for ad-hoc strings that only need the
   * non-empty invariant. Subclasses should provide their own factory
   * with a more meaningful name (e.g. `DecisionTitle.from(...)`).
   */
  public static create(
    raw: string,
    fieldName = "value",
  ): NonEmptyString {
    const trimmed = NonEmptyString.normalize(raw, fieldName);
    return new NonEmptyString(trimmed);
  }

  /**
   * Normalizes and validates a raw string. Subclasses can call this
   * inside their own factories to reuse the invariants.
   */
  protected static normalize(raw: string, fieldName: string): string {
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      throw new InvalidInputError(
        `${fieldName} must contain at least one non-whitespace character`,
        { field: fieldName },
      );
    }
    return trimmed;
  }

  public toString(): string {
    return this.value;
  }

  public length(): number {
    return this.value.length;
  }

  public equals(other: NonEmptyString): boolean {
    if (this === other) return true;
    if (other.constructor !== this.constructor) return false;
    return this.value === other.value;
  }
}
