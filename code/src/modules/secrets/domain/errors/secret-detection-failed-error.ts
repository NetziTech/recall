import { SecretsDomainError } from "./secrets-domain-error.ts";

/**
 * Raised when the secrets scanner ITSELF fails — distinct from a normal
 * "scanner found a secret" outcome.
 *
 * Examples that warrant this error:
 * - The pattern registry returned an inconsistent state (e.g. a
 *   `DetectorName` referenced by a finding cannot be resolved back to a
 *   `SecretPattern`).
 * - The entropy calculator returned a non-finite value (NaN/Infinity).
 * - An adapter exception bubbled up that the scanner could not classify.
 *
 * "Found a secret" is NOT an error: it is the success path that yields a
 * `SanitizedText` whose `findings` is non-empty, optionally followed by
 * a downstream rejection at the application layer (which DOES surface as
 * `JsonRpcErrorCodes.SECRET_DETECTED` -32105). The distinction matters
 * because operators reading logs need to tell apart "user typed a secret
 * we caught" (expected, frequent) from "scanner is broken" (rare, alarm-
 * worthy).
 *
 * Invariants:
 * - `code` is the stable identifier `secrets.detection-failed`.
 * - `detectorName` (when provided) names the detector whose
 *   misbehaviour triggered the failure, so adapters can surface it in
 *   diagnostics.
 * - `jsonRpcCode` is `null`: a scanner failure is an internal error, not
 *   a protocol-level user-input rejection. Adapters typically map this
 *   to the standard JSON-RPC `INTERNAL_ERROR` (-32603) — but the domain
 *   refuses to claim that code itself, since the catalog
 *   (`docs/02-protocolo-mcp.md` §6) reserves it for the transport layer.
 */
export class SecretDetectionFailedError extends SecretsDomainError {
  public readonly code = "secrets.detection-failed";
  public readonly jsonRpcCode: number | null = null;
  public readonly detectorName: string | null;

  public constructor(
    message: string,
    options?: { detectorName?: string; cause?: unknown },
  ) {
    super(
      message,
      options !== undefined ? { cause: options.cause } : undefined,
    );
    this.detectorName = options?.detectorName ?? null;
  }
}
