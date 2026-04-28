import type { Confidence } from "../../../../shared/domain/value-objects/confidence.ts";
import type { DetectorName } from "./detector-name.ts";
import type { SecretKind } from "./secret-kind.ts";
import type { SecretMatch } from "./secret-match.ts";
import { SecretSources, type SecretSource } from "./secret-source.ts";

/**
 * Composite value object describing a single detection made by the
 * scanner.
 *
 * A `SecretFinding` aggregates everything an audit-log row needs to
 * carry without owning identity (the identity belongs to the
 * `SecretAuditEntry` aggregate that wraps it):
 *
 * - `kind`: the canonical taxonomy bucket (`api_key`, `oauth_token`,
 *   ...). Drives the response action.
 * - `position`: the offset and redacted evidence inside the scanned
 *   text, expressed via `SecretMatch`.
 * - `confidence`: the detector's confidence in the finding. Regex-based
 *   detectors typically emit `Confidence.full()`; the entropy detector
 *   emits a lower value because it is heuristic
 *   (`docs/11-seguridad-modos.md` §6 — "muchos falsos positivos
 *   posibles").
 * - `source`: where the scanned text came from
 *   (`{kind: "text"; field}` | `{kind: "filePath"; path}` |
 *   `{kind: "logLine"; line}`). Lets adapters surface the location in
 *   error messages.
 * - `detectedBy`: the `DetectorName` so the audit trail can correlate
 *   findings with `PatternRegistry` entries.
 *
 * Invariants:
 * - All fields are required (no nullable slots): a finding without a
 *   `source` would be ambiguous, a finding without a `detectedBy` could
 *   not be traced back to its origin.
 * - The wrapped fields are themselves invariants-checked VOs, so the
 *   composite cannot be constructed in an inconsistent state.
 *
 * Equality:
 * - Two findings are equal iff every wrapped field is equal. Confidence
 *   and source variants are compared with their respective `equals`
 *   methods; `position`, `kind` and `detectedBy` use their VO
 *   equality. Same kind detected by two different detectors at the
 *   same offset are NOT equal — the audit trail tracks them separately.
 */
export class SecretFinding {
  private constructor(
    public readonly kind: SecretKind,
    public readonly position: SecretMatch,
    public readonly confidence: Confidence,
    public readonly source: SecretSource,
    public readonly detectedBy: DetectorName,
  ) {}

  /**
   * Builds a `SecretFinding` from already-validated VOs. The factory is
   * deliberately thin: every component is a VO that has already
   * enforced its own invariants on construction, so there is nothing
   * left to validate compositionally.
   */
  public static create(input: {
    kind: SecretKind;
    position: SecretMatch;
    confidence: Confidence;
    source: SecretSource;
    detectedBy: DetectorName;
  }): SecretFinding {
    return new SecretFinding(
      input.kind,
      input.position,
      input.confidence,
      input.source,
      input.detectedBy,
    );
  }

  public equals(other: SecretFinding): boolean {
    if (this === other) return true;
    if (!this.kind.equals(other.kind)) return false;
    if (!this.position.equals(other.position)) return false;
    if (!this.confidence.equals(other.confidence)) return false;
    if (!SecretSources.equals(this.source, other.source)) return false;
    if (!this.detectedBy.equals(other.detectedBy)) return false;
    return true;
  }
}
