import * as crypto from "node:crypto";

import { secureZero } from "../../../../shared/infrastructure/crypto/secure-zero.ts";
import { CliInfrastructureError } from "../errors/cli-infrastructure-error.ts";
import { readPassphrase } from "./passphrase-prompt.ts";

/**
 * Prompts the user for a passphrase twice, returns the first buffer
 * iff both entries match byte-for-byte.
 *
 * Comparison contract:
 *   - We MUST NOT short-circuit on length mismatch: a `===` check or a
 *     bytewise loop that bails on the first differing byte both leak the
 *     length (and the index of divergence) via timing, even though the
 *     loop runs in JS-land. `crypto.timingSafeEqual` is the only stable
 *     constant-time primitive available; it requires equal-length inputs.
 *   - To satisfy the equal-length precondition WITHOUT leaking the
 *     length difference, we pad the shorter buffer up to the length of
 *     the longer with cryptographically random bytes (`crypto.randomBytes`).
 *     The padded bytes never equal the corresponding bytes of the other
 *     buffer (probabilistically negligible: 2^-8N), so `timingSafeEqual`
 *     returns `false` in constant time regardless of WHERE the divergence
 *     occurred. The classic alternative (pad with zeros, then check
 *     `len1 === len2`) leaks length via the second check.
 *
 * Memory hygiene:
 *   - On mismatch, BOTH buffers are zeroed via `secureZero` before
 *     throwing. The exception carries no plaintext.
 *   - On match, the SECOND buffer is zeroed and the FIRST is returned to
 *     the caller. The caller now owns the lifetime contract for that
 *     buffer (typically: pass to KDF, then `secureZero`).
 *
 * @param prompt1 - Label shown for the first entry (e.g. "Passphrase: ").
 * @param prompt2 - Label shown for the second entry (e.g. "Confirma: ").
 * @returns Buffer with the agreed passphrase bytes (NFKC UTF-8). Caller
 *   owns disposal.
 * @throws {CliInfrastructureError} `cli.passphrase-mismatch` when the
 *   two entries differ.
 *
 * @see `docs/12-lineamientos-arquitectura.md` §1.5.5 — ADR-005 Q5.
 */
export async function confirmPassphrase(
  prompt1: string,
  prompt2: string,
): Promise<Buffer> {
  const first = await readPassphrase(prompt1);
  let second: Buffer | null = null;
  try {
    second = await readPassphrase(prompt2);
  } catch (err) {
    // If the second read fails (TTY closed, length cap, ...) the first
    // buffer must still be zeroed before propagating the error.
    secureZero(first);
    throw err;
  }

  const matches = constantTimeEqualPadded(first, second);
  if (!matches) {
    secureZero(first);
    secureZero(second);
    throw CliInfrastructureError.passphraseMismatch();
  }

  secureZero(second);
  return first;
}

/**
 * Constant-time equality check that tolerates different-length inputs
 * without leaking the length difference.
 *
 * Strategy: pad the shorter buffer up to the longer's length with
 * random bytes, then call `crypto.timingSafeEqual` on equal-length
 * buffers. The padding bytes will (with overwhelming probability) NOT
 * match the corresponding bytes of the longer buffer, so the result is
 * `false` whenever the original lengths differ. When the original
 * lengths are equal, the function reduces to a straight
 * `timingSafeEqual` over the originals.
 *
 * Why not pad with zeros: if both buffers end in zeros (e.g. user typed
 * a passphrase whose NFKC encoding happens to end in NUL — unlikely but
 * not impossible), the zero-padded "shorter" buffer would compare equal
 * to the longer in those trailing bytes, biasing the result. Random
 * padding has no such bias.
 *
 * Exported for direct testing of the padding semantics; not part of the
 * module's public surface (use `confirmPassphrase` instead).
 *
 * @internal
 */
export function constantTimeEqualPadded(a: Buffer, b: Buffer): boolean {
  if (a.length === b.length) {
    return crypto.timingSafeEqual(a, b);
  }
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  // Build a length-matched view of `shorter` with random padding. The
  // padded buffer lives only inside this function and is zeroed before
  // returning so we don't leave random pad in the pool.
  const padded = Buffer.allocUnsafeSlow(longer.length);
  shorter.copy(padded, 0, 0, shorter.length);
  const pad = crypto.randomBytes(longer.length - shorter.length);
  pad.copy(padded, shorter.length);
  secureZero(pad);
  const result = crypto.timingSafeEqual(padded, longer);
  secureZero(padded);
  return result;
}
