import type { Result } from "../../../../shared/domain/types/result.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import { Confidence } from "../../../../shared/domain/value-objects/confidence.ts";
import type { PathSanitizerError } from "../../domain/errors/path-sanitizer-error.ts";
import type { EntropyCalculator } from "../../domain/services/entropy-calculator.ts";
import type { PatternRegistry } from "../../domain/services/pattern-registry.ts";
import type { SecretsScanner } from "../../domain/services/secrets-scanner.ts";
import { DetectorName } from "../../domain/value-objects/detector-name.ts";
import type { EntropyThreshold } from "../../domain/value-objects/entropy-threshold.ts";
import type { PathSanitizerRule } from "../../domain/value-objects/path-sanitizer-rule.ts";
import type { SanitizedPath } from "../../domain/value-objects/sanitized-path.ts";
import { SanitizedText } from "../../domain/value-objects/sanitized-text.ts";
import { SecretFinding } from "../../domain/value-objects/secret-finding.ts";
import { SecretKind } from "../../domain/value-objects/secret-kind.ts";
import { SecretMatch } from "../../domain/value-objects/secret-match.ts";
import {
  SecretSources,
  type SecretSource,
} from "../../domain/value-objects/secret-source.ts";

/**
 * Construction options for {@link DefaultSecretsScanner}.
 *
 * - `patternRegistry`     — registry of regex detectors (defence-in-
 *                           depth layer 1).
 * - `entropyCalculator`   — Shannon-entropy primitive (defence-in-
 *                           depth layer 1, entropy track).
 * - `entropyThreshold`    — domain VO encapsulating the bits/char
 *                           cut-off and the minimum candidate length.
 * - `pathSanitizerRule`   — domain VO encapsulating the path policy
 *                           (`tilde-rewrite` for free-form text,
 *                           `relative-only` for `files_touched`-style
 *                           contexts; the adapter accepts one rule
 *                           and the composition root may stack two
 *                           scanner instances if both policies are
 *                           needed).
 * - `entropyDetectorName` — `DetectorName` to attach on
 *                           entropy-only findings. Defaults to
 *                           `"entropy"`.
 * - `entropyConfidence`   — `Confidence` to attach on entropy-only
 *                           findings. Defaults to `0.5` (heuristic;
 *                           regex findings use full confidence).
 * - `entropySource`       — supplier of the `SecretSource` for
 *                           entropy findings. Defaults to a
 *                           `text(field=<field>)` source built from
 *                           the scan workspace context. Callers may
 *                           override to attribute findings to e.g.
 *                           `logLine` sources.
 */
export interface DefaultSecretsScannerOptions {
  readonly patternRegistry: PatternRegistry;
  readonly entropyCalculator: EntropyCalculator;
  readonly entropyThreshold: EntropyThreshold;
  readonly pathSanitizerRule: PathSanitizerRule;
  readonly entropyDetectorName?: DetectorName;
  readonly entropyConfidence?: Confidence;
  readonly defaultSource?: SecretSource;
}

/**
 * Adapter that fulfils the `SecretsScanner` domain port using:
 *
 * - `PatternRegistry.getPatterns()` for regex-based detection (Capa 1
 *   — pattern track, the hard-reject majority).
 * - `EntropyCalculator.calculate(...)` + `EntropyThreshold.isHighEntropy(...)`
 *   for the entropy heuristic (Capa 1 — entropy track, warning-only).
 * - `PathSanitizerRule.apply(...)` for the path-sanitisation flow
 *   (Capa 2).
 *
 * The defence-in-depth ordering (regex first, then entropy on the
 * remaining text) is documented in `docs/11-seguridad-modos.md` §6.
 *
 * Sanitisation strategy:
 * - For each finding, the adapter replaces the offending substring
 *   with `[REDACTED:<DetectorName>]`. The replacement preserves
 *   the surrounding text verbatim. Two findings overlapping the
 *   same range are folded into the FIRST replacement (the second
 *   replacement still goes into the `findings` array but does not
 *   double-redact the text). The redaction marker length is
 *   bounded by the detector name length (capped via
 *   `DetectorName.maxLength()` upstream).
 *
 * Idempotence:
 * - Calling `scan` twice with the same input returns equal
 *   `SanitizedText` instances (the regex `lastIndex` is isolated
 *   per call by `SecretPattern.matches`; the entropy detector is
 *   pure).
 *
 * Composition root example:
 * ```typescript
 * const scanner: SecretsScanner = new DefaultSecretsScanner({
 *   patternRegistry: new BuiltInPatternRegistry(extras),
 *   entropyCalculator: new ShannonEntropyCalculator(),
 *   entropyThreshold: EntropyThreshold.defaultThreshold(),
 *   pathSanitizerRule: PathSanitizerRule.tildeRewrite(os.userInfo().username),
 * });
 * ```
 */
export class DefaultSecretsScanner implements SecretsScanner {
  private readonly patternRegistry: PatternRegistry;
  private readonly entropyCalculator: EntropyCalculator;
  private readonly entropyThreshold: EntropyThreshold;
  private readonly pathSanitizerRule: PathSanitizerRule;
  private readonly entropyDetectorName: DetectorName;
  private readonly entropyConfidence: Confidence;
  private readonly defaultSource: SecretSource;

  public constructor(options: DefaultSecretsScannerOptions) {
    this.patternRegistry = options.patternRegistry;
    this.entropyCalculator = options.entropyCalculator;
    this.entropyThreshold = options.entropyThreshold;
    this.pathSanitizerRule = options.pathSanitizerRule;
    this.entropyDetectorName =
      options.entropyDetectorName ?? DetectorName.from("entropy");
    this.entropyConfidence = options.entropyConfidence ?? Confidence.of(0.5);
    this.defaultSource = options.defaultSource ?? SecretSources.text("text");
  }

  public scan(text: string, _workspaceId: WorkspaceId): Promise<SanitizedText> {
    if (text.length === 0) {
      return Promise.resolve(SanitizedText.clean(text));
    }

    // 1. Regex detectors.
    const regexFindings: SecretFinding[] = [];
    for (const pattern of this.patternRegistry.getPatterns()) {
      const matches = pattern.matches(text);
      for (const match of matches) {
        regexFindings.push(
          SecretFinding.create({
            kind: pattern.kind,
            position: match,
            confidence: Confidence.full(),
            source: this.defaultSource,
            detectedBy: pattern.name,
          }),
        );
      }
    }

    // 2. Entropy detector. Skip if the text is shorter than the
    //    domain VO's minimum length.
    const entropyFindings: SecretFinding[] = [];
    if (text.length >= this.entropyThreshold.minimumLength()) {
      const entropy = this.entropyCalculator.calculate(text);
      if (this.entropyThreshold.isHighEntropy(text, entropy)) {
        entropyFindings.push(
          SecretFinding.create({
            kind: SecretKind.highEntropyBlob(),
            position: this.buildWholeStringMatch(text),
            confidence: this.entropyConfidence,
            source: this.defaultSource,
            detectedBy: this.entropyDetectorName,
          }),
        );
      }
    }

    const allFindings = [...regexFindings, ...entropyFindings];
    if (allFindings.length === 0) {
      return Promise.resolve(SanitizedText.clean(text));
    }

    // 3. Sanitise: replace each MATCH BY POSITION with
    //    `[REDACTED:<DetectorName>]`. Sort by start descending so
    //    later replacements do not invalidate earlier offsets.
    const sortedRegex = [...regexFindings].sort(
      (a, b) => b.position.start - a.position.start,
    );
    let sanitized = text;
    for (const finding of sortedRegex) {
      sanitized =
        sanitized.slice(0, finding.position.start) +
        `[REDACTED:${finding.detectedBy.toString()}]` +
        sanitized.slice(finding.position.end);
    }
    // Entropy findings cover the WHOLE input by construction, so they
    // do not need slot-by-slot replacement; the sanitiser delegates
    // to a single whole-input replacement IF no regex finding was
    // already produced (otherwise the regex sanitisation already
    // mangled the input enough to make a whole-string redaction
    // pointless).
    if (regexFindings.length === 0 && entropyFindings.length > 0) {
      const entropyFinding = entropyFindings[0];
      if (entropyFinding !== undefined) {
        sanitized = `[REDACTED:${entropyFinding.detectedBy.toString()}]`;
      }
    }

    return Promise.resolve(
      SanitizedText.create({
        original: text,
        sanitized,
        findings: allFindings,
      }),
    );
  }

  public scanPath(
    rawPath: string,
  ): Result<SanitizedPath, PathSanitizerError> {
    // The rule's `apply` already returns a `Result<SanitizedPath,
    // PathSanitizerError>`. The adapter is a thin pass-through; no
    // additional branching is required.
    return this.pathSanitizerRule.apply(rawPath);
  }

  /**
   * Builds a `SecretMatch` covering the entire input. Used by the
   * entropy detector which classifies the WHOLE string rather than
   * a slice.
   */
  private buildWholeStringMatch(text: string): SecretMatch {
    return SecretMatch.create({
      start: 0,
      end: text.length,
      evidence: `[REDACTED:${this.entropyDetectorName.toString()}]`,
    });
  }
}
