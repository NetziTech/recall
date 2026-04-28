import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";
import type { SecretFinding } from "./secret-finding.ts";

/**
 * Value object wrapping the *result* of running the secrets scanner over
 * a piece of text.
 *
 * The VO carries three fields that always travel together:
 *
 * - `original`: the verbatim input the scanner received. Kept on the VO
 *   so adapters can compare lengths, decide whether to retry, or roll
 *   back to the unredacted form when the user explicitly opts in
 *   (`docs/11-seguridad-modos.md` §6 — "Sanitizacion post-hoc"
 *   replaces by `[REDACTED:secret-detected-by-audit-2026-04-27]`).
 *   The presence of the original is intentional and accepted: this VO
 *   lives only inside the secrets bounded context, never crosses the
 *   transport boundary unredacted.
 * - `sanitized`: the same text with every detected secret replaced by
 *   the canonical redaction marker. When `findings` is empty,
 *   `sanitized === original` (the factory enforces this invariant).
 * - `findings`: the list of `SecretFinding`s the scanner emitted, in
 *   the order they were detected. Frozen so callers cannot mutate the
 *   evidence after construction.
 *
 * Invariants:
 * - `original` and `sanitized` are strings (the empty string is legal:
 *   scanning empty input yields an empty sanitized result with no
 *   findings).
 * - `findings.length === 0` implies `sanitized === original`. This
 *   keeps the no-findings case free of accidental rewrites.
 * - The `findings` array is frozen at construction time.
 *
 * Equality:
 * - Two `SanitizedText` instances are equal iff `original`, `sanitized`
 *   AND `findings` (length + element-wise `equals`) match.
 */
export class SanitizedText {
  private constructor(
    public readonly original: string,
    public readonly sanitized: string,
    public readonly findings: readonly SecretFinding[],
  ) {}

  /**
   * Builds a `SanitizedText` from explicit fields. Validates the
   * cross-field invariants (no findings ⇒ sanitized equals original;
   * inputs are strings).
   */
  public static create(input: {
    original: string;
    sanitized: string;
    findings: readonly SecretFinding[];
  }): SanitizedText {
    if (typeof input.original !== "string") {
      throw new InvalidInputError("original text must be a string", {
        field: "original",
      });
    }
    if (typeof input.sanitized !== "string") {
      throw new InvalidInputError("sanitized text must be a string", {
        field: "sanitized",
      });
    }
    if (input.findings.length === 0 && input.sanitized !== input.original) {
      throw new InvalidInputError(
        "sanitized text must equal original when there are no findings",
        { field: "sanitized" },
      );
    }
    return new SanitizedText(
      input.original,
      input.sanitized,
      Object.freeze(input.findings.slice()),
    );
  }

  /**
   * Convenience factory for the trivial case of a clean scan: the
   * input was inspected and contained no secret. The sanitized form
   * equals the original verbatim.
   */
  public static clean(text: string): SanitizedText {
    return SanitizedText.create({
      original: text,
      sanitized: text,
      findings: [],
    });
  }

  public hasFindings(): boolean {
    return this.findings.length > 0;
  }

  public findingCount(): number {
    return this.findings.length;
  }

  public equals(other: SanitizedText): boolean {
    if (this === other) return true;
    if (this.original !== other.original) return false;
    if (this.sanitized !== other.sanitized) return false;
    if (this.findings.length !== other.findings.length) return false;
    for (let i = 0; i < this.findings.length; i += 1) {
      const here = this.findings[i];
      const there = other.findings[i];
      if (here === undefined || there === undefined) return false;
      if (!here.equals(there)) return false;
    }
    return true;
  }
}
