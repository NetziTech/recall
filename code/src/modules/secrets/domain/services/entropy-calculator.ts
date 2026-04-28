/**
 * Driven port (output port) for the Shannon-entropy calculator used by
 * the layer-1 entropy detector.
 *
 * The concrete implementation (a simple histogram + log2 sum) lives in
 * `infrastructure/`. The domain only knows the contract:
 *
 * - `calculate(text)` returns the Shannon entropy of `text` in BITS PER
 *   CHARACTER. The reference formula is
 *
 *     H(X) = - Σ p(x) · log2(p(x))
 *
 *   over the histogram of code-units in `text`. The result is a finite
 *   non-negative number; an empty input yields `0`.
 *
 * Contract:
 * - The function is pure and stateless. Two calls with identical input
 *   MUST return the exact same value (bitwise comparable).
 * - The function MUST NOT throw on legal inputs. An adapter that
 *   detects an internal failure (overflow, NaN intermediate) reports
 *   it by throwing `SecretDetectionFailedError`, NOT by returning a
 *   sentinel value.
 *
 * Why a dedicated port instead of inlining the math:
 * - The calculator is a single-method abstraction, but isolating it
 *   keeps the scanner adapter small (one fewer concern) and lets us
 *   swap in a future implementation that, say, uses byte alphabets
 *   instead of UTF-16 code-units when the host environment supports
 *   it.
 */
export interface EntropyCalculator {
  calculate(text: string): number;
}
