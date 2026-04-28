import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";
import { NonEmptyString } from "../../../../shared/domain/value-objects/non-empty-string.ts";

/**
 * Maximum length, in characters, of a `DetectorName`.
 *
 * Detector names are short identifiers (`"regex.aws_key"`,
 * `"entropy"`, `"path.traversal"`) that flow into audit-log entries and
 * structured log fields. The 100-character cap is generous enough to
 * carry namespaced identifiers (`"regex.provider.subkind"`) while
 * preventing pathological values from polluting downstream storage.
 */
const MAX_DETECTOR_NAME_LENGTH = 100;

/**
 * Pattern enforcing the canonical shape of a detector name. Two
 * compositional rules apply:
 *
 * - Allowed characters: ASCII letters, digits, `_`, `-`, `.`. Anything
 *   else (spaces, slashes, unicode) is rejected so the name can be
 *   safely inlined into log fields, JSON keys and CLI output.
 * - Must start with a letter, so the name remains a legal identifier
 *   when projected onto formats that distinguish identifiers from
 *   numeric literals.
 *
 * The pattern is anchored (`^...$`) and case-sensitive: detector names
 * are conventionally lowercase, but the VO does not enforce case so
 * adapters can model namespaces like `"Regex.AwsKey"` if they prefer.
 */
const DETECTOR_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]*$/;

/**
 * Value object identifying which detector flagged a secret.
 *
 * Detector names are the bridge between findings and the pattern
 * registry: a `SecretFinding` carries the name, and adapters can call
 * `PatternRegistry.getPattern(name)` to recover the regex source for
 * diagnostics. Examples documented in `docs/11-seguridad-modos.md` §6:
 *
 * - `"regex.aws_key"` for the AWS access-key regex.
 * - `"regex.jwt"` for the JWT regex.
 * - `"regex.github_token"` for `gh[ps]_...`.
 * - `"entropy"` for the Shannon-entropy detector.
 * - `"path.traversal"` for the path-sanitiser refusal of `..` segments.
 *
 * Invariants (in addition to `NonEmptyString` ones):
 * - The value matches `DETECTOR_NAME_PATTERN`.
 * - The value is at most `MAX_DETECTOR_NAME_LENGTH` characters.
 *
 * Equality is the standard `NonEmptyString` rule: same canonical value
 * AND same concrete subclass.
 */
export class DetectorName extends NonEmptyString {
  /**
   * Builds a `DetectorName` from a raw string. Validates non-emptiness,
   * the maximum length and the canonical character set.
   */
  public static from(raw: string): DetectorName {
    const trimmed = NonEmptyString.normalize(raw, "detector_name");
    if (trimmed.length > MAX_DETECTOR_NAME_LENGTH) {
      throw new InvalidInputError(
        `detector name must be at most ${String(MAX_DETECTOR_NAME_LENGTH)} characters (got: ${String(trimmed.length)})`,
        { field: "detector_name" },
      );
    }
    if (!DETECTOR_NAME_PATTERN.test(trimmed)) {
      throw new InvalidInputError(
        `detector name must match ${DETECTOR_NAME_PATTERN.toString()} (got: "${raw}")`,
        { field: "detector_name" },
      );
    }
    return new DetectorName(trimmed);
  }
}
