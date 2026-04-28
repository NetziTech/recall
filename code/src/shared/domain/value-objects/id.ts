import { InvalidInputError } from "../errors/invalid-input-error.ts";
import type { Brand } from "../types/branded.ts";

/**
 * Branded string representing a UUID v7 identifier.
 *
 * The brand parameter `TBrand` is the *aggregate* the id belongs to
 * (e.g. `"workspace"`, `"decision"`, `"learning"`). It exists only at
 * the type level, so `WorkspaceIdValue` and `DecisionIdValue` are NOT
 * assignable to one another even though both are strings.
 */
export type IdValue<TBrand extends string> = Brand<string, TBrand>;

/**
 * Generic value object for entity identifiers.
 *
 * Identifiers in this codebase are UUID v7s — sortable by time, which
 * matches the `epoch_ms` timestamp model and lets the persistence layer
 * order entries by id without a separate index. The whole catalog
 * (`docs/02-protocolo-mcp.md` §1) is built around this convention.
 *
 * Invariants:
 * - The wrapped string MUST be a valid UUID v7 in canonical lowercase
 *   form (`xxxxxxxx-xxxx-7xxx-[8|9|a|b]xxx-xxxxxxxxxxxx`).
 * - The brand `TBrand` differentiates ids of different aggregate types
 *   so they cannot be passed in the wrong slot.
 * - `equals(other)` compares only the wrapped value, not the brand. The
 *   brand check is performed by the type system at compile time.
 *
 * Equality is intentionally case-sensitive over the canonical form: the
 * factory normalises to lowercase, so two ids built from the same input
 * (regardless of original case) will be equal.
 */
export class Id<TBrand extends string> {
  protected constructor(protected readonly value: IdValue<TBrand>) {}

  /**
   * Builds an id from a raw string. Validates UUID v7 shape and
   * normalises to lowercase. Subclasses with named brands (e.g.
   * `WorkspaceId`) typically override this with a more specific
   * factory that pins the brand and the field name.
   */
  public static create<TBrand extends string>(
    raw: string,
    fieldName = "id",
  ): Id<TBrand> {
    const normalised = Id.normalize(raw, fieldName);
    return new Id<TBrand>(normalised as IdValue<TBrand>);
  }

  /**
   * Validates and canonicalises a raw id string. Reusable by subclass
   * factories that need to keep their own constructor private.
   */
  protected static normalize(raw: string, fieldName: string): string {
    if (typeof raw !== "string" || raw.length === 0) {
      throw new InvalidInputError(`${fieldName} must be a non-empty string`, {
        field: fieldName,
      });
    }
    const normalised = raw.toLowerCase();
    if (!Id.isUuidV7(normalised)) {
      throw new InvalidInputError(
        `${fieldName} must be a valid UUID v7 (got: "${raw}")`,
        { field: fieldName },
      );
    }
    return normalised;
  }

  /**
   * Validates the canonical UUID v7 shape. Accepts the standard
   * `8-4-4-4-12` hexadecimal grouping with the version nibble fixed at
   * `7` and the variant nibble in `{8, 9, a, b}` (RFC 9562 variant 1).
   */
  private static isUuidV7(candidate: string): boolean {
    const uuidV7Pattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    return uuidV7Pattern.test(candidate);
  }

  public toString(): string {
    return this.value;
  }

  /**
   * Returns the branded primitive value. Use sparingly; prefer passing
   * the `Id` instance around so the type system keeps tracking the
   * brand.
   */
  public toPrimitive(): IdValue<TBrand> {
    return this.value;
  }

  public equals(other: Id<TBrand>): boolean {
    if (this === other) return true;
    return this.value === other.value;
  }
}
