import type { EntropyCalculator } from "../../domain/services/entropy-calculator.ts";

/**
 * Adapter that fulfils the `EntropyCalculator` domain port using the
 * Shannon entropy formula:
 *
 *     H(X) = - Σ p(x) · log2(p(x))
 *
 * over the histogram of UTF-16 code-units in the input. Returns the
 * entropy in bits per character.
 *
 * Why UTF-16 code-units (and not bytes):
 * - JavaScript strings are UTF-16 internally; iterating with `for
 *   (... of text)` advances per code-point but per-codepoint
 *   distribution would require a much larger histogram for inputs
 *   with surrogate pairs. UTF-16 code-units give the same answer as
 *   the bytes-after-encoding approach for ASCII-heavy inputs (the
 *   workspace's overwhelming majority) and stay deterministic for
 *   the rest.
 * - The detection threshold documented in
 *   `docs/11-seguridad-modos.md` §6 (`entropy_threshold: 4.5`) was
 *   chosen empirically against ASCII-heavy text, so UTF-16
 *   code-units match the intent.
 *
 * Edge cases:
 * - Empty input: returns `0`. The domain VO `EntropyThreshold`
 *   already short-circuits inputs shorter than its minimum length,
 *   so this branch is only reached if a caller bypassed the VO.
 * - Single-character input (length === 1): the histogram has one
 *   bucket with probability 1, so `-1 · log2(1) = 0`. Returns `0`.
 * - All-identical characters: same outcome as single-character
 *   (probability 1 on a single bucket).
 *
 * Numerical stability:
 * - We use `Math.log2` directly. For a 1024-character input the
 *   smallest non-zero probability is `1/1024`, so `log2` produces
 *   well-defined finite values across the practical range.
 *
 * Composition root example:
 * ```typescript
 * const entropy: EntropyCalculator = new ShannonEntropyCalculator();
 * ```
 */
export class ShannonEntropyCalculator implements EntropyCalculator {
  public calculate(text: string): number {
    if (typeof text !== "string" || text.length === 0) return 0;

    // Build a histogram of code-units. `Map<number, number>` keeps
    // the API explicit; the alternative (`Record<string, number>`)
    // is roughly the same allocation but loses the numeric key
    // discipline.
    const histogram = new Map<number, number>();
    for (let i = 0; i < text.length; i += 1) {
      const code = text.charCodeAt(i);
      histogram.set(code, (histogram.get(code) ?? 0) + 1);
    }

    if (histogram.size === 1) return 0;

    const total = text.length;
    let entropy = 0;
    for (const count of histogram.values()) {
      const p = count / total;
      entropy -= p * Math.log2(p);
    }
    return entropy;
  }
}
