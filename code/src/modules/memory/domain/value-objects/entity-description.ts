import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";
import { NonEmptyString } from "../../../../shared/domain/value-objects/non-empty-string.ts";

/**
 * Maximum length, in characters, of the description of an `Entity`.
 *
 * Entity descriptions feed Capa 6 (Code Map) of the context bundle
 * (`docs/04-capas-contexto.md` §3.6 — 600-token budget), so the cap is
 * intentionally generous (5000 characters) but bounded so a single
 * pathological description cannot exhaust the whole layer.
 */
const MAX_ENTITY_DESCRIPTION_LENGTH = 5000;

/**
 * Inner text of a known entity description. Subclass of
 * `NonEmptyString` so the trim + non-empty + length-cap invariants live
 * in one place. Not exported standalone: callers always go through
 * `EntityDescription.of(text)` (which produces the wrapping VO) so the
 * unknown/known distinction stays visible at the call site.
 */
class EntityDescriptionText extends NonEmptyString {
  public static from(raw: string): EntityDescriptionText {
    const trimmed = NonEmptyString.normalize(raw, "description");
    if (trimmed.length > MAX_ENTITY_DESCRIPTION_LENGTH) {
      throw new InvalidInputError(
        `entity description must be at most ${String(MAX_ENTITY_DESCRIPTION_LENGTH)} characters (got: ${String(trimmed.length)})`,
        { field: "description" },
      );
    }
    return new EntityDescriptionText(trimmed);
  }
}

/**
 * Discriminated union view of an `EntityDescription`. Useful for
 * adapters and renderers that need to pattern-match on the variant.
 */
export type EntityDescriptionValue =
  | { readonly kind: "unknown"; readonly text: null }
  | { readonly kind: "known"; readonly text: string };

/**
 * Value object representing the textual description of an `Entity`.
 *
 * Mirrors the `entities.description TEXT NOT NULL` column documented in
 * `docs/03-modelo-datos.md` §4.5. Even though the persistence schema
 * declares the column NOT NULL, the domain models the description as a
 * **discriminated union** so the application layer can distinguish
 * between:
 *
 * - `unknown`: we have not learned a description yet (the curator can
 *   prioritise filling it). The persistence adapter materialises this
 *   as the empty string in the SQL column, but at the domain level we
 *   never confuse it with a legitimately-empty description.
 * - `known`: a non-empty `EntityDescriptionText` is available.
 *
 * This DU mirrors the `LastUsed { kind: "never" | "at" }` and `Scope
 * { kind: "project" | "module" }` patterns adopted across the rest of
 * the module (lineamiento §1.6 — "discriminated unions over `T | null`
 * ambiguity").
 *
 * Invariants:
 * - When `kind === "unknown"`, no inner text is exposed.
 * - When `kind === "known"`, the inner text is a non-empty
 *   `EntityDescriptionText` (validated by its own factory).
 * - Instances are immutable; "updating" produces a new VO via the
 *   relevant `Entity.updateDescription` mutation.
 *
 * Equality:
 * - Two descriptions are equal iff their `kind` matches and (when
 *   `kind === "known"`) their inner text matches.
 */
export class EntityDescription {
  private constructor(
    public readonly kind: "unknown" | "known",
    private readonly text: EntityDescriptionText | null,
  ) {}

  /**
   * Builds the "we have not learned a description yet" variant.
   */
  public static unknown(): EntityDescription {
    return new EntityDescription("unknown", null);
  }

  /**
   * Builds the "we know the description" variant. The supplied text
   * is wrapped in the internal `EntityDescriptionText` VO so the
   * invariants (non-empty after trim, max length) are enforced
   * uniformly.
   */
  public static of(rawText: string): EntityDescription {
    return new EntityDescription("known", EntityDescriptionText.from(rawText));
  }

  /**
   * Returns the discriminated-union view. The persistence adapter and
   * any renderer that needs to materialise the description (for FTS5,
   * for the Code Map layer, ...) consume this representation.
   */
  public toValue(): EntityDescriptionValue {
    if (this.kind === "known" && this.text !== null) {
      return { kind: "known", text: this.text.toString() };
    }
    return { kind: "unknown", text: null };
  }

  /**
   * Convenience predicate.
   */
  public isKnown(): boolean {
    return this.kind === "known";
  }

  /**
   * Convenience predicate.
   */
  public isUnknown(): boolean {
    return this.kind === "unknown";
  }

  /**
   * Returns the underlying string when known, `null` when unknown.
   * Useful for adapters that need to write the value into a
   * `TEXT NOT NULL` column (they materialise unknown as the empty
   * string at the SQL boundary).
   */
  public toStringOrNull(): string | null {
    if (this.kind === "known" && this.text !== null) {
      return this.text.toString();
    }
    return null;
  }

  public equals(other: EntityDescription): boolean {
    if (this === other) return true;
    if (this.kind !== other.kind) return false;
    if (this.text === null && other.text === null) return true;
    if (this.text === null || other.text === null) return false;
    return this.text.equals(other.text);
  }
}
