import { webcrypto } from "node:crypto";

import type { RandomBytes } from "../../application/ports/out/random-bytes.port.ts";
import { RandomBytesError } from "../errors/random-bytes-error.ts";

/**
 * Maximum bytes a single `webcrypto.getRandomValues` call accepts.
 * The Web Crypto spec caps it at 65,536 bytes per call.
 *
 * The adapter rejects requests above the cap with
 * `RandomBytesError.invalidLength` rather than chunking internally:
 * keys / salts / IVs in this codebase never exceed 32 bytes, so
 * folding chunking into the adapter would be dead code.
 */
const MAX_BYTES_PER_CALL = 65536;

/**
 * Adapter that fulfils the `RandomBytes` port using Node 20+'s
 * `webcrypto.getRandomValues` (`node:crypto`).
 *
 * Why the host CSPRNG (and not a noble-hashes call):
 * - `getRandomValues` delegates to the OS CSPRNG (`/dev/urandom` on
 *   Linux/macOS, `BCryptGenRandom` on Windows). The same source the
 *   noble-hashes package uses internally.
 * - Skipping the noble-hashes layer keeps the adapter dependency
 *   surface minimal: no library version pins for a primitive that
 *   has been a Node API since v18.
 *
 * Contract enforcement:
 * - Refuses zero-length, negative, non-integer, non-finite and
 *   oversized requests with `RandomBytesError.invalidLength`.
 * - Refuses runtimes without `webcrypto.getRandomValues` with
 *   `RandomBytesError.unavailable`. Node 20 always exposes it; the
 *   guard exists for hardened test environments.
 *
 * Composition root example:
 * ```typescript
 * const randomBytes: RandomBytes = new WebCryptoRandomBytes();
 * ```
 */
export class WebCryptoRandomBytes implements RandomBytes {
  public next(length: number): Uint8Array {
    if (!Number.isFinite(length)) {
      throw RandomBytesError.invalidLength(length);
    }
    if (!Number.isInteger(length)) {
      throw RandomBytesError.invalidLength(length);
    }
    if (length <= 0) {
      throw RandomBytesError.invalidLength(length);
    }
    if (length > MAX_BYTES_PER_CALL) {
      throw RandomBytesError.invalidLength(length);
    }

    if (typeof webcrypto.getRandomValues !== "function") {
      throw RandomBytesError.unavailable();
    }

    const buffer = new Uint8Array(length);
    try {
      webcrypto.getRandomValues(buffer);
    } catch (cause: unknown) {
      throw RandomBytesError.libraryFailure(cause);
    }
    return buffer;
  }
}
