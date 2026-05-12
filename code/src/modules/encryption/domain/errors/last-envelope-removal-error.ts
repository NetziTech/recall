import type { KeyId } from "../value-objects/key-id.ts";
import { EncryptionDomainError } from "./encryption-domain-error.ts";

/**
 * Raised when the application layer attempts to remove the last
 * remaining `KeyEnvelope` from an `EncryptionConfig` aggregate.
 *
 * Per `docs/11-seguridad-modos.md` §7 ("Multi-key"), the master key
 * itself never leaves storage in the clear; it only exists wrapped
 * inside one or more envelopes. Removing the last envelope would
 * therefore make the workspace permanently unrecoverable: the
 * master key would no longer be unwrappable by ANY passphrase.
 *
 * The aggregate refuses this operation outright. To "rotate out"
 * the only existing envelope the operator must FIRST add a
 * replacement envelope (with a different passphrase) and THEN
 * remove the old one. This makes the dangerous "no-key" state
 * representationally impossible.
 *
 * Invariants:
 * - `code` is the stable identifier `encryption.last-envelope-removal`.
 * - `keyId` identifies the envelope the caller tried to remove.
 * - `jsonRpcCode` is `null`: the protocol catalog
 *   (`docs/02-protocolo-mcp.md` §6) does not allocate a code for
 *   "last envelope removal". Adapters typically map this to
 *   `INVALID_PARAMS`.
 */
export class LastEnvelopeRemovalError extends EncryptionDomainError {
  public readonly code = "encryption.last-envelope-removal";
  public readonly jsonRpcCode: number | null = null;
  public readonly keyId: KeyId;

  public constructor(keyId: KeyId, cause?: unknown) {
    super(
      `cannot remove key envelope ${keyId.toString()}: it is the only remaining envelope and removing it would make the workspace unrecoverable`,
      cause,
    );
    this.keyId = keyId;
  }
}
