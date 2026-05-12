import { EncryptionInfrastructureError } from "./encryption-infrastructure-error.ts";

/**
 * Thrown when the CSPRNG adapter cannot produce random bytes.
 *
 * Two scenarios warrant this error:
 * - The host runtime does not expose `crypto.getRandomValues`.
 *   Practically impossible on Node 20+ (which is the engines floor of
 *   the project, see `code/package.json`), but the adapter still
 *   guards against it — defence in depth costs nothing.
 * - The caller asked for an invalid `length` (zero, negative,
 *   non-integer, exceeding the platform's per-call cap of 65536
 *   bytes). The port contract refuses these at the boundary so the
 *   condition reaches this error only on adapter bugs.
 *
 * Invariants:
 * - `code` is `crypto.random-bytes-failed`.
 */
export class RandomBytesError extends EncryptionInfrastructureError {
  public readonly code = "crypto.random-bytes-failed";

  private constructor(message: string, cause?: unknown) {
    super(message, cause);
  }

  public static unavailable(): RandomBytesError {
    return new RandomBytesError(
      "host runtime does not expose a CSPRNG (crypto.getRandomValues)",
    );
  }

  public static invalidLength(length: number): RandomBytesError {
    return new RandomBytesError(
      `CSPRNG was asked for an invalid number of bytes: ${String(length)}`,
    );
  }

  public static libraryFailure(cause: unknown): RandomBytesError {
    return new RandomBytesError(
      "CSPRNG primitive failed inside the host runtime",
      cause,
    );
  }
}
