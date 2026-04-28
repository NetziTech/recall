import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";

/**
 * Maximum length, in characters, of the `evidence` snippet attached to
 * a `SecretMatch`.
 *
 * The evidence is a *redacted* preview of the secret used purely for
 * diagnostics (e.g. CLI output, audit-log rows). Capping it at 120
 * characters keeps log lines bounded while leaving room for the typical
 * `[REDACTED:reason]` annotations the infrastructure layer wraps the
 * secret in.
 */
const MAX_EVIDENCE_LENGTH = 120;

/**
 * Value object representing the position of a secret match inside the
 * scanned text.
 *
 * The match is described as a half-open range `[start, end)` over UTF-16
 * code-units (matching the convention of `String.prototype.indexOf` and
 * `RegExp.exec`). Two derived fields are kept on the VO for ergonomics:
 *
 * - `length`: the number of code-units covered by the match. Stored
 *   explicitly so callers do not have to recompute `end - start` and so
 *   the invariants can be expressed locally.
 * - `evidence`: a short, redacted snippet that adapters can include in
 *   error messages and audit logs without exposing the secret. The
 *   redaction policy lives in infrastructure (`docs/11-seguridad-modos.md`
 *   §6 "Sanitizacion post-hoc"); this VO just guarantees the snippet is
 *   well-formed and bounded.
 *
 * Invariants:
 * - `start` is a non-negative finite integer.
 * - `end` is a finite integer strictly greater than `start`.
 * - `length === end - start` AND `length > 0`.
 * - `evidence` is a non-empty string, at most
 *   `MAX_EVIDENCE_LENGTH` characters. Empty evidence would defeat the
 *   diagnostics purpose; oversized evidence would risk leaking the very
 *   secret the match is supposed to flag.
 *
 * Equality:
 * - Two `SecretMatch` instances are equal iff `start`, `end`, `length`
 *   AND `evidence` match. The evidence is part of the identity because
 *   two findings at the same offset by different detectors may surface
 *   different redacted previews.
 */
export class SecretMatch {
  private constructor(
    public readonly start: number,
    public readonly end: number,
    public readonly length: number,
    public readonly evidence: string,
  ) {}

  /**
   * Builds a `SecretMatch` from explicit fields. Validates every
   * invariant; the application layer can rely on a constructed instance
   * to be safe to render.
   */
  public static create(input: {
    start: number;
    end: number;
    evidence: string;
  }): SecretMatch {
    if (!Number.isFinite(input.start)) {
      throw new InvalidInputError("match start must be a finite number", {
        field: "start",
      });
    }
    if (!Number.isInteger(input.start)) {
      throw new InvalidInputError("match start must be an integer", {
        field: "start",
      });
    }
    if (input.start < 0) {
      throw new InvalidInputError("match start must be non-negative", {
        field: "start",
      });
    }
    if (!Number.isFinite(input.end)) {
      throw new InvalidInputError("match end must be a finite number", {
        field: "end",
      });
    }
    if (!Number.isInteger(input.end)) {
      throw new InvalidInputError("match end must be an integer", {
        field: "end",
      });
    }
    if (input.end <= input.start) {
      throw new InvalidInputError(
        `match end must be strictly greater than start (got: start=${String(input.start)}, end=${String(input.end)})`,
        { field: "end" },
      );
    }
    if (typeof input.evidence !== "string") {
      throw new InvalidInputError("match evidence must be a string", {
        field: "evidence",
      });
    }
    if (input.evidence.length === 0) {
      throw new InvalidInputError("match evidence must not be empty", {
        field: "evidence",
      });
    }
    if (input.evidence.length > MAX_EVIDENCE_LENGTH) {
      throw new InvalidInputError(
        `match evidence must be at most ${String(MAX_EVIDENCE_LENGTH)} characters (got: ${String(input.evidence.length)})`,
        { field: "evidence" },
      );
    }
    const length = input.end - input.start;
    return new SecretMatch(input.start, input.end, length, input.evidence);
  }

  public equals(other: SecretMatch): boolean {
    if (this === other) return true;
    return (
      this.start === other.start &&
      this.end === other.end &&
      this.length === other.length &&
      this.evidence === other.evidence
    );
  }
}
