import type { KeyId } from "../value-objects/key-id.ts";
import { EncryptionDomainError } from "./encryption-domain-error.ts";

/**
 * Raised when the application layer adds a `KeyEnvelope` whose
 * decoded master key does not match the one already protecting the
 * workspace.
 *
 * The multi-key contract documented in
 * `docs/11-seguridad-modos.md` §7 ("Multi-key (v0.5+)") requires
 * every envelope to wrap the SAME master key. Without that
 * invariant, `unlockWith(envelope_A)` and `unlockWith(envelope_B)`
 * would return different keys, both able to open the SQLCipher
 * database — except they couldn't, because SQLCipher accepts only
 * one key per session, so the workspace would silently break the
 * moment the second envelope was used.
 *
 * The aggregate verifies the invariant by demanding the caller
 * also unlock the new envelope (in the application layer, with the
 * candidate passphrase) BEFORE invoking `addEnvelope(...)`. The
 * decoded `MasterKey` is then compared against the currently
 * unlocked one. A mismatch triggers this error.
 *
 * Security invariants (NON-NEGOTIABLE):
 * - The error message MUST NOT include the bytes of either master
 *   key. The redaction sentinel of `MasterKey.toString()`
 *   guarantees this even if a key gets accidentally interpolated
 *   into the message.
 * - The only contextual data carried by the error is the `keyId`
 *   of the offending envelope.
 *
 * Invariants:
 * - `code` is the stable identifier `encryption.master-key-mismatch`.
 * - `keyId` identifies the envelope being added.
 * - `jsonRpcCode` is `null`: the protocol catalog
 *   (`docs/02-protocolo-mcp.md` §6) does not allocate a code for
 *   "envelope master-key mismatch". Adapters typically map this to
 *   `INVALID_PARAMS`.
 */
export class MasterKeyMismatchError extends EncryptionDomainError {
  public readonly code = "encryption.master-key-mismatch";
  public readonly jsonRpcCode: number | null = null;
  public readonly keyId: KeyId;

  public constructor(keyId: KeyId, cause?: unknown) {
    super(
      `cannot add key envelope ${keyId.toString()}: the wrapped master key does not match the workspace's current master key`,
      cause,
    );
    this.keyId = keyId;
  }
}
