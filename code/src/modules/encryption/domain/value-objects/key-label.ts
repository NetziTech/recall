import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";
import { NonEmptyString } from "../../../../shared/domain/value-objects/non-empty-string.ts";

/**
 * Maximum length, in characters, of a key envelope label.
 *
 * The label is a human-readable description of which key/passphrase
 * produced an envelope (e.g. "alice@laptop", "recovery-key",
 * "ci-deploy-bot"). Capping at 200 chars keeps it scannable in CLI
 * output (`mcp-memoria audit`, `mcp-memoria add-key --list`) and on
 * any future UI surface.
 */
const KEY_LABEL_MAX_LENGTH = 200;

/**
 * Value object representing the optional human-readable label of a
 * `KeyEnvelope`.
 *
 * The label is purely descriptive: nothing in the cryptographic
 * flow depends on it, so it can be safely changed or deleted at
 * any time without affecting the ability to unlock the workspace.
 * It exists so the multi-key feature documented in
 * `docs/11-seguridad-modos.md` §7 ("Cada miembro del equipo con su
 * propia clave") is operable: without labels, the `key_envelopes`
 * array would be a list of opaque blobs.
 *
 * Invariants (in addition to those of `NonEmptyString`):
 * - The trimmed label is at most `KEY_LABEL_MAX_LENGTH` characters.
 * - The label contains no newline characters (`\n` or `\r`).
 *   Labels appear in single-line contexts; embedded line breaks
 *   would corrupt every renderer.
 *
 * Equality:
 * - Inherited from `NonEmptyString`: same trimmed text, same
 *   concrete subclass.
 */
export class KeyLabel extends NonEmptyString {
  private constructor(value: string) {
    super(value);
  }

  /**
   * Builds a `KeyLabel` from a raw string. Performs the
   * `NonEmptyString` checks plus the additional length and
   * single-line invariants.
   *
   * Note: we re-implement the trim+non-empty check here instead of
   * delegating to `NonEmptyString.create` because the parent factory
   * returns a `NonEmptyString` (not a `KeyLabel`) and we need a
   * narrower return type. Mirrors the pattern used by
   * `DisplayName.create`.
   */
  public static override create(raw: string): KeyLabel {
    if (typeof raw !== "string") {
      throw new InvalidInputError("key label must be a string", {
        field: "key_label",
      });
    }
    if (raw.includes("\n") || raw.includes("\r")) {
      throw new InvalidInputError(
        "key label must not contain line breaks",
        { field: "key_label" },
      );
    }
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      throw new InvalidInputError(
        "key label must contain at least one non-whitespace character",
        { field: "key_label" },
      );
    }
    if (trimmed.length > KEY_LABEL_MAX_LENGTH) {
      throw new InvalidInputError(
        `key label must be at most ${String(KEY_LABEL_MAX_LENGTH)} characters (got: ${String(trimmed.length)})`,
        { field: "key_label" },
      );
    }
    return new KeyLabel(trimmed);
  }

  /** Convenience accessor; equivalent to `toString()`. */
  public asString(): string {
    return this.toString();
  }

  /** Exposes the configured maximum length for documentation/tests. */
  public static maxLength(): number {
    return KEY_LABEL_MAX_LENGTH;
  }
}
