import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";
import { NonEmptyString } from "../../../../shared/domain/value-objects/non-empty-string.ts";

/**
 * Maximum number of characters allowed in a workspace display name.
 *
 * The number is a deliberate ergonomic choice (it comfortably fits on a
 * CLI line and on most UI surfaces) rather than a database limitation:
 * the underlying column is `TEXT` (see
 * `docs/03-modelo-datos.md` §2 — `display_name` lives inside
 * `config.json` and is not stored in a typed SQL column at all).
 */
const DISPLAY_NAME_MAX_LENGTH = 200;

/**
 * Value object representing the human-readable name of a workspace.
 *
 * Corresponds to `.recall/config.json → display_name` (see
 * `docs/03-modelo-datos.md` §2). It is what the user sees in CLI
 * prompts, audit logs and (eventually) any UI; the immutable identity
 * of the workspace is `WorkspaceId`, not the display name.
 *
 * Invariants (in addition to those of `NonEmptyString`):
 * - The trimmed length is at most `DISPLAY_NAME_MAX_LENGTH` characters.
 * - The string contains no newline characters (`\n` or `\r`). Display
 *   names appear in single-line contexts; embedded line breaks would
 *   corrupt every renderer.
 *
 * Equality:
 * - Inherited from `NonEmptyString`: same trimmed text, same concrete
 *   subclass.
 */
export class DisplayName extends NonEmptyString {
  private constructor(value: string) {
    super(value);
  }

  /**
   * Builds a `DisplayName` from a raw string. Performs the
   * `NonEmptyString` checks plus the additional length and
   * single-line invariants.
   *
   * Note: we re-implement the trim+non-empty check here instead of
   * delegating to `NonEmptyString.create` because the parent factory
   * returns a `NonEmptyString` (not a `DisplayName`) and TypeScript's
   * access rules block calling the `protected static normalize` of a
   * sibling-context parent through a subclass static. The duplication
   * is local and intentional.
   */
  public static override create(raw: string): DisplayName {
    if (typeof raw !== "string") {
      throw new InvalidInputError("display name must be a string", {
        field: "display_name",
      });
    }
    if (raw.includes("\n") || raw.includes("\r")) {
      throw new InvalidInputError(
        "display name must not contain line breaks",
        { field: "display_name" },
      );
    }
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      throw new InvalidInputError(
        "display name must contain at least one non-whitespace character",
        { field: "display_name" },
      );
    }
    if (trimmed.length > DISPLAY_NAME_MAX_LENGTH) {
      throw new InvalidInputError(
        `display name must be at most ${String(DISPLAY_NAME_MAX_LENGTH)} characters (got: ${String(trimmed.length)})`,
        { field: "display_name" },
      );
    }
    return new DisplayName(trimmed);
  }

  /** Convenience accessor; equivalent to `toString()`. */
  public asString(): string {
    return this.toString();
  }

  /** Exposes the configured maximum length for documentation/tests. */
  public static maxLength(): number {
    return DISPLAY_NAME_MAX_LENGTH;
  }
}
