import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";

/**
 * Lower bound for an entropy threshold, in bits per character.
 *
 * Shannon entropy of an arbitrary string is bounded by `log2(alphabet
 * size)` — the alphabet of UTF-16 code-units caps it around 16. We use
 * `0` as the lower bound (entropy is always non-negative) and `8` as
 * the upper bound: in the contexts we scan (ASCII-heavy text), the
 * theoretical maximum is `log2(256) = 8` bits per byte, and any
 * threshold above that is a configuration mistake (no string would ever
 * trip it).
 *
 * The recommended default in `docs/11-seguridad-modos.md` §6 is `4.5`
 * bits/char (the value also documented in the example
 * `entropy_threshold: 4.5` config), which sits comfortably inside the
 * accepted range.
 */
const ENTROPY_THRESHOLD_LOWER_BOUND = 0;
const ENTROPY_THRESHOLD_UPPER_BOUND = 8;

/**
 * Minimum length, in characters, of a candidate string for the entropy
 * detector to consider it.
 *
 * Per `docs/11-seguridad-modos.md` §6 ("Entropy check: strings > 20
 * chars con entropia Shannon > 4.5 bits/char"), strings shorter than
 * 20 characters are NEVER classified as high-entropy regardless of
 * their actual entropy. The threshold VO captures this rule so callers
 * cannot accidentally lower it (a 4-character random string would have
 * very high entropy yet be too short to be a meaningful secret).
 */
const ENTROPY_MIN_LENGTH = 20;

/**
 * Value object representing the entropy threshold above which a string
 * is flagged as a `high_entropy_blob` candidate.
 *
 * The threshold is expressed in bits per character. The detection rule
 * is intentionally TWO-fold (length AND entropy):
 * - The string must be at least `ENTROPY_MIN_LENGTH` characters long.
 * - The Shannon entropy of the string must be strictly greater than
 *   the threshold.
 *
 * Both checks live on this VO via `isHighEntropy(text, entropyOf)` so
 * the rule is centralised. The actual entropy computation is supplied
 * by the caller (typically the `EntropyCalculator` port) — the domain
 * does not own the math, but it owns the *policy* (when does a number
 * count as "high"?).
 *
 * Invariants:
 * - `bitsPerChar` is a finite number in
 *   `[ENTROPY_THRESHOLD_LOWER_BOUND, ENTROPY_THRESHOLD_UPPER_BOUND]`.
 * - Instances are immutable.
 *
 * Equality:
 * - Two `EntropyThreshold` are equal iff their numeric values are
 *   exactly equal. Floating-point equality is intentional: thresholds
 *   are configuration values, not measurements.
 */
export class EntropyThreshold {
  private constructor(public readonly bitsPerChar: number) {}

  /**
   * Convenience factory for the default threshold documented in
   * `docs/11-seguridad-modos.md` §6 (`entropy_threshold: 4.5`).
   */
  public static defaultThreshold(): EntropyThreshold {
    return new EntropyThreshold(4.5);
  }

  /**
   * Builds an `EntropyThreshold` from a raw number in
   * `[ENTROPY_THRESHOLD_LOWER_BOUND, ENTROPY_THRESHOLD_UPPER_BOUND]`.
   */
  public static of(bitsPerChar: number): EntropyThreshold {
    if (!Number.isFinite(bitsPerChar)) {
      throw new InvalidInputError(
        "entropy threshold must be a finite number",
        { field: "bits_per_char" },
      );
    }
    if (
      bitsPerChar < ENTROPY_THRESHOLD_LOWER_BOUND ||
      bitsPerChar > ENTROPY_THRESHOLD_UPPER_BOUND
    ) {
      throw new InvalidInputError(
        `entropy threshold must be in the closed interval [${String(ENTROPY_THRESHOLD_LOWER_BOUND)}, ${String(ENTROPY_THRESHOLD_UPPER_BOUND)}] bits/char (got: ${String(bitsPerChar)})`,
        { field: "bits_per_char" },
      );
    }
    return new EntropyThreshold(bitsPerChar);
  }

  /**
   * Decides whether `text` is "high entropy" according to this
   * threshold.
   *
   * The caller supplies the entropy value (typically computed by the
   * `EntropyCalculator` port). The VO enforces two rules:
   * - The text must be at least `ENTROPY_MIN_LENGTH` characters long.
   * - The supplied entropy must be strictly greater than the threshold.
   *
   * Returning `false` when the text is empty or shorter than the
   * minimum length is intentional: those inputs cannot meaningfully
   * carry a secret, so flagging them would only generate noise.
   */
  public isHighEntropy(text: string, entropyBitsPerChar: number): boolean {
    if (typeof text !== "string") return false;
    if (text.length < ENTROPY_MIN_LENGTH) return false;
    if (!Number.isFinite(entropyBitsPerChar)) {
      throw new InvalidInputError(
        "entropy value must be a finite number",
        { field: "entropy_bits_per_char" },
      );
    }
    if (entropyBitsPerChar < ENTROPY_THRESHOLD_LOWER_BOUND) {
      throw new InvalidInputError(
        "entropy value must be non-negative",
        { field: "entropy_bits_per_char" },
      );
    }
    return entropyBitsPerChar > this.bitsPerChar;
  }

  /**
   * Returns the minimum candidate length the detector enforces. Useful
   * for fast-path checks at the application layer (skip the entropy
   * call entirely on short inputs).
   */
  public minimumLength(): number {
    return ENTROPY_MIN_LENGTH;
  }

  public toNumber(): number {
    return this.bitsPerChar;
  }

  public equals(other: EntropyThreshold): boolean {
    return this.bitsPerChar === other.bitsPerChar;
  }
}
