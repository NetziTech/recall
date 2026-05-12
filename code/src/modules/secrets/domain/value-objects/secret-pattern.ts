import { InvalidPatternError } from "../errors/invalid-pattern-error.ts";
import type { DetectorName } from "./detector-name.ts";
import type { SecretKind } from "./secret-kind.ts";
import { SecretMatch } from "./secret-match.ts";

/**
 * Maximum length, in characters, of the regex source that
 * `SecretPattern.create(...)` will accept.
 *
 * The cap (4 KiB) is large enough to fit the most elaborate registry
 * entries and small enough to refuse pathological inputs that would slow
 * down the matcher (`docs/11-seguridad-modos.md` §6 — the registry
 * accepts `extra_patterns` from user config; a hard cap protects against
 * a misconfigured `config.json` that would attempt to compile a runaway
 * regex).
 */
const MAX_PATTERN_SOURCE_LENGTH = 4096;

/**
 * Maximum number of matches `matches(text)` will surface for a single
 * scan call.
 *
 * Two reasons for the cap:
 * - DOS protection: a malicious input could match thousands of times
 *   (e.g. a very loose generic-key regex against a long base64 blob).
 * - Audit-log hygiene: each finding becomes one `SecretAuditEntry`. A
 *   cap of 256 keeps the trail bounded per scanned payload while still
 *   covering legitimate scenarios.
 */
const MAX_MATCHES_PER_SCAN = 256;

/**
 * Value object encapsulating one regex-based secret detector.
 *
 * A `SecretPattern` carries the **source** of the regex (a string the
 * registry can echo for diagnostics), the **kind** of secret it is
 * meant to detect (so findings can be classified without consulting an
 * external map), and the **detector name** (so audit entries can refer
 * back to the pattern by id). The compiled `RegExp` is kept private to
 * the VO; consumers go through `matches(text)` to obtain a list of
 * `SecretMatch` instances.
 *
 * The `matches` method is the only public way to use the pattern. It
 * intentionally returns a snippet-bearing `SecretMatch[]` rather than
 * raw `RegExpExecArray` results so:
 * - The redaction policy (truncating the captured text into evidence)
 *   lives in one place.
 * - The infrastructure layer cannot bypass the bounds-checking and
 *   evidence-capping invariants by reading the captured string
 *   directly.
 *
 * Invariants:
 * - The compiled `RegExp` always carries the global flag (`g`); the
 *   factory enforces this so `matches` can iterate via `exec` in a
 *   loop without an infinite repetition.
 * - The source string is at most `MAX_PATTERN_SOURCE_LENGTH` characters
 *   long.
 * - The redaction snippet for each match is bounded to a configurable
 *   evidence-length cap (delegated to `SecretMatch`).
 *
 * Equality:
 * - Two `SecretPattern` instances are equal iff they share the same
 *   `name` (the registry identifier is the natural key). Two patterns
 *   with the same source but different names are NOT equal: the
 *   registry distinguishes them by name and so do audit logs.
 */
export class SecretPattern {
  private constructor(
    public readonly name: DetectorName,
    public readonly kind: SecretKind,
    public readonly source: string,
    private readonly compiled: RegExp,
  ) {}

  /**
   * Builds a `SecretPattern` from a regex source. Compiles the regex
   * with the global flag forcibly set so callers cannot accidentally
   * register a non-global pattern.
   *
   * Throws `InvalidPatternError` (NOT `InvalidInputError`) when the
   * regex source is unusable: the secrets bounded context owns that
   * specific failure mode and adapters branch on it. The original error
   * is attached as `cause` for diagnostics, but the regex source is NOT
   * surfaced (see `InvalidPatternError` rationale).
   */
  public static create(input: {
    name: DetectorName;
    kind: SecretKind;
    source: string;
  }): SecretPattern {
    if (typeof input.source !== "string") {
      throw new InvalidPatternError(
        "secret pattern source must be a string",
        { patternName: input.name.toString() },
      );
    }
    if (input.source.length === 0) {
      throw new InvalidPatternError(
        "secret pattern source must not be empty",
        { patternName: input.name.toString() },
      );
    }
    if (input.source.length > MAX_PATTERN_SOURCE_LENGTH) {
      throw new InvalidPatternError(
        `secret pattern source must be at most ${String(MAX_PATTERN_SOURCE_LENGTH)} characters (got: ${String(input.source.length)})`,
        { patternName: input.name.toString() },
      );
    }
    let compiled: RegExp;
    try {
      // The global flag is forced ON: the matcher relies on
      // `exec` advancing `lastIndex` to enumerate every match in one
      // pass. Forcing the flag here means callers cannot accidentally
      // construct a pattern that yields only the first match.
      compiled = new RegExp(input.source, "g");
    } catch (cause) {
      throw new InvalidPatternError(
        `secret pattern source is not a valid regular expression`,
        { patternName: input.name.toString() },
        cause,
      );
    }
    return new SecretPattern(input.name, input.kind, input.source, compiled);
  }

  /**
   * Scans `text` and returns up to `MAX_MATCHES_PER_SCAN` matches.
   *
   * The implementation isolates the regex state by taking a fresh copy
   * of the compiled pattern (`new RegExp(this.compiled)`) so concurrent
   * scans in the same process do not race on `lastIndex`. Each match is
   * projected into a `SecretMatch` whose `evidence` is the captured
   * substring redacted to `[REDACTED:<length>]` form — the raw secret
   * NEVER leaves this method.
   */
  public matches(text: string): readonly SecretMatch[] {
    if (typeof text !== "string" || text.length === 0) {
      return Object.freeze([]);
    }
    // Copying the compiled regex isolates `lastIndex` so two
    // concurrent `matches(...)` calls cannot interfere. The cost is a
    // single allocation per scan — negligible compared to the regex
    // execution itself.
    const scanner = new RegExp(this.compiled);
    const collected: SecretMatch[] = [];
    let safety = 0;
    while (safety < MAX_MATCHES_PER_SCAN) {
      const found = scanner.exec(text);
      if (found === null) break;
      const start = found.index;
      const captured = found[0];
      const end = start + captured.length;
      collected.push(
        SecretMatch.create({
          start,
          end,
          evidence: SecretPattern.redactEvidence(captured),
        }),
      );
      // Safety against zero-width matches: if the regex matched the
      // empty string, advance manually so the loop terminates.
      if (captured.length === 0) {
        scanner.lastIndex = scanner.lastIndex + 1;
      }
      safety += 1;
    }
    return Object.freeze(collected);
  }

  public equals(other: SecretPattern): boolean {
    if (this === other) return true;
    return this.name.equals(other.name);
  }

  /**
   * Replaces a captured secret with `[REDACTED:<length>]`. The length
   * is preserved so audit logs convey the *size* of what was caught
   * (useful for tracing which detector triggered) without leaking any
   * of the bytes.
   *
   * The redacted form is always shorter than the evidence cap enforced
   * by `SecretMatch`, so there is no risk of the evidence factory
   * rejecting it.
   */
  private static redactEvidence(captured: string): string {
    return `[REDACTED:${String(captured.length)}]`;
  }
}
