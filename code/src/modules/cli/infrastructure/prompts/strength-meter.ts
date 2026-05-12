import { CliInfrastructureError } from "../errors/cli-infrastructure-error.ts";

/**
 * Minimum number of characters (NOT bytes — counted by UTF-16 code
 * units after NFKC) we accept regardless of entropy.
 *
 * NIST SP 800-63B §5.1.1.2 mandates a minimum of 8 chars for
 * memorised secrets; it also recommends 12+ for offline-attack
 * resistance. Our threat model is offline (anyone with a stolen
 * encrypted workspace file can run Argon2id at billions of iterations
 * with a GPU farm), so we pick the stricter floor. A 7-char passphrase
 * with high apparent entropy ("Tr0ub4d") still falls to dictionary
 * mangling rules in seconds, so a length floor that is INDEPENDENT of
 * the entropy estimate is the only safe gate.
 */
const MIN_LENGTH_CHARS = 12;

/**
 * Default Shannon entropy floor, in bits. ADR-005 Q5 fixes this at 60
 * bits — high enough to defeat single-machine offline attacks against
 * Argon2id with our default parameters (~250 ms per guess on commodity
 * hardware → 2^60 / (4 * 10^9 guesses-per-year-of-GPU-cluster) > 100
 * years), but low enough that a 4-word diceware sequence
 * (~51.7 bits) is rejected and prompts the user to add one more word.
 */
const DEFAULT_MIN_BITS = 60;

/**
 * Validates that `buffer` carries a passphrase strong enough for use as
 * a KDF input. Throws `CliInfrastructureError.weakPassphrase` on
 * failure; returns nothing on success.
 *
 * **Two-gate policy**:
 *   1. Length floor — `decodedChars < MIN_LENGTH_CHARS` is rejected
 *      regardless of entropy. NIST SP 800-63B §5.1.1.2 floor with a
 *      project-specific bump to 12 (see `MIN_LENGTH_CHARS` docstring).
 *   2. Entropy floor — Shannon entropy of the UTF-8 byte stream must be
 *      `>= minBits`.
 *
 * **Shannon entropy formula** (per Claude E. Shannon, 1948, "A
 *   Mathematical Theory of Communication" §1.6):
 *
 *     H(X) = - SUM[ p_i * log2(p_i) ]  over all symbols i
 *
 *   where `p_i` is the empirical frequency of byte value `i`. The
 *   *total* entropy of an N-byte string is then `N * H(X)`. We compute
 *   `H(X)` by counting byte occurrences (256-bucket histogram), then
 *   normalising. Bytes with zero count contribute zero to the sum
 *   (taking the limit `lim p->0+ p*log2(p) = 0`).
 *
 * **Why Shannon and NOT zxcvbn**: zxcvbn uses wordlists (~80 MB packed)
 *   to detect dictionary-based mangling, which is the *gold-standard*
 *   passphrase strength estimator. However, zxcvbn would dominate our
 *   npm bundle size (currently ~14 MB) and add a non-trivial runtime
 *   dependency. ADR-005 Q5 accepts the trade-off: Shannon is a *lower
 *   bound* on strength (overestimates "Tr0ub4dor&3" because it does not
 *   know the dictionary structure), but combined with the 12-char
 *   length floor + 60-bit entropy floor the residual false-positives
 *   are bounded. Users who want defense-in-depth are expected to use
 *   a diceware-style generator (one is shipped in `docs/`).
 *
 * **Counted unit**: bytes of the UTF-8 encoding of `buffer`. We do not
 *   re-decode to Unicode code points because the KDF consumes raw
 *   bytes, so the relevant statistical alphabet IS the byte alphabet.
 *   A "single emoji that encodes to 4 bytes with high variance" carries
 *   ~4 bits of Shannon entropy under this measure (vs ~32 bits if
 *   measured at code-point level), which is the correct conservative
 *   answer.
 *
 * @param buffer - The passphrase bytes (NFKC UTF-8, as returned by
 *   `readPassphrase`).
 * @param minBits - Optional override for the Shannon entropy floor.
 *   Defaults to {@link DEFAULT_MIN_BITS} (60).
 *
 * @throws {CliInfrastructureError} `cli.weak-passphrase` when either
 *   gate fails. The error message names the failing dimension
 *   ("too short" or "entropy below floor") so the CLI can render a
 *   Spanish-language hint without re-running the check.
 */
export function assertStrongPassphrase(
  buffer: Buffer,
  minBits: number = DEFAULT_MIN_BITS,
): void {
  // Length floor uses the decoded character count (NFKC-normalised),
  // not the byte length. A 12-char Spanish passphrase with accented
  // characters encodes to ~14 bytes; bouncing that on byte length
  // would be a false positive.
  const decodedChars = buffer.toString("utf8").length;
  if (decodedChars < MIN_LENGTH_CHARS) {
    throw CliInfrastructureError.weakPassphrase(
      `minimo ${MIN_LENGTH_CHARS} caracteres (recibido: ${decodedChars})`,
    );
  }

  const totalBits = shannonBits(buffer);
  if (totalBits < minBits) {
    // Round to one decimal for the user-visible message; the comparison
    // itself is performed on the unrounded value.
    const rounded = Math.round(totalBits * 10) / 10;
    throw CliInfrastructureError.weakPassphrase(
      `entropia Shannon ${rounded} bits < ${minBits} bits requeridos`,
    );
  }
}

/**
 * Returns the Shannon entropy of `buffer`, in bits, multiplied by its
 * length to yield the *total* informational content.
 *
 * Exported for direct testing against fixed vectors (constant string
 * → 0 bits; uniform random 256-byte stream → ~2048 bits).
 *
 * @internal
 */
export function shannonBits(buffer: Buffer): number {
  if (buffer.length === 0) return 0;
  // 256-bucket histogram of byte frequencies.
  const counts = new Array<number>(256).fill(0);
  for (const byte of buffer) {
    // After `Buffer.fill(0)` semantics we know `byte` is in 0..255.
    const idx = byte;
    const prev = counts[idx];
    counts[idx] = (prev ?? 0) + 1;
  }
  const total = buffer.length;
  let perSymbol = 0;
  for (const count of counts) {
    if (count === 0) continue;
    const p = count / total;
    perSymbol -= p * Math.log2(p);
  }
  return perSymbol * total;
}
