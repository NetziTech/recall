import type { Clock } from "../../../../shared/application/ports/clock.port.ts";
import type { Logger } from "../../../../shared/application/ports/logger.port.ts";
import { type DomainEvent } from "../../../../shared/domain/types/domain-event.ts";
import {
  err,
  isErr,
  ok,
  type Result,
} from "../../../../shared/domain/types/result.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import { EncryptionNotInitializedError } from "../../domain/errors/encryption-not-initialized-error.ts";
import { KeyValidationFailedError } from "../../domain/errors/key-validation-failed-error.ts";
import { EncryptionDestroyed } from "../../domain/events/encryption-destroyed.ts";
import type { EnvelopeCipher } from "../../domain/services/envelope-cipher.ts";
import type { KeyValidator } from "../../domain/services/key-validator.ts";
import type { EncryptionConfigRepository } from "../../domain/repositories/encryption-config-repository.ts";
import type { KeyEnvelope } from "../../domain/value-objects/key-envelope.ts";
import type { MasterKey } from "../../domain/value-objects/master-key.ts";
import type { Passphrase } from "../../domain/value-objects/passphrase.ts";
import type { DestroyEncryption } from "../ports/in/destroy-encryption.port.ts";
import type { Kdf } from "../ports/out/kdf.port.ts";

/**
 * Use case: destroy the encryption slice of a workspace, preserving
 * the (now decryption-irrelevant) workspace metadata.
 *
 * Orchestrates the cryptographic half of the `encrypted -> private`
 * mode transition documented in `docs/11-seguridad-modos.md` §5. See
 * the input-port JSDoc (`DestroyEncryption`) for the high-level
 * contract.
 *
 * Flow:
 * 1. Loads the `EncryptionConfig` aggregate.
 *    - If absent → return `EncryptionNotInitializedError` (the
 *      caller can treat as already-destroyed; the use case does NOT
 *      re-throw).
 * 2. Iterates the persisted `KeyEnvelope`s, re-derives the user
 *    key from the supplied passphrase against each envelope's
 *    `KdfParams`, and attempts AEAD-unwrap. Same exact path as
 *    `UnlockEncryptionUseCase.tryUnwrap`.
 *    - On AEAD authentication failure → next envelope.
 *    - On candidate master key recovered → run the
 *      `KeyValidator` against the persisted `KeyValidatorBlob`. If
 *      the validator accepts, the candidate is the authoritative
 *      master key for this workspace.
 *    - If no envelope produced a valid candidate → return
 *      `KeyValidationFailedError`.
 * 3. Calls `repository.delete(workspaceId)` to remove the on-disk
 *    encryption slice atomically.
 * 4. Emits `EncryptionDestroyed` (past tense; persisted to the
 *    audit log subscriber by the composition root).
 *
 * Authority gate:
 * - The use case re-validates authority via the passphrase even
 *   when the aggregate happens to be in the "unlocked" state in
 *   memory: a stale unlock left over from a previous session is
 *   not a sufficient proof-of-ownership for an irrecoverable
 *   operation. The passphrase MUST match a current envelope.
 *
 * Domain note (intentional cohesion):
 * - The use case does NOT call `EncryptionConfig.lock(...)` before
 *   `repository.delete(...)`. The aggregate is being torn down
 *   wholesale; emitting an `EncryptionLocked` event right before
 *   `EncryptionDestroyed` would clutter the audit trail without
 *   adding signal. The aggregate is simply discarded after the
 *   delete returns.
 *
 * Boundary note (NOT this use case's job):
 * - This use case does NOT touch `memoria.db` / `vectors.db`. The
 *   workspace module's mode-change flow re-keys / decrypts the
 *   SQLCipher data BEFORE invoking this use case. After this use
 *   case returns, the SQLCipher metadata is gone but the
 *   underlying database files remain in their previous state; the
 *   composition root MUST guarantee the data was already migrated
 *   to a plain (or differently-keyed) container.
 *
 * Security:
 * - Logs only public metadata (workspace id, envelope count). NEVER
 *   the passphrase, derived key, master key or validator
 *   plaintext.
 * - Primitive failures (KDF, AEAD non-authentication, persistence)
 *   propagate as `InfrastructureError` exceptions; the use case
 *   does NOT swallow them.
 * - Recovered candidate `MasterKey` instances are best-effort
 *   discarded by leaving the references unreachable after each
 *   `tryUnwrap` iteration. The standard JS runtime offers no
 *   `mlock`-style API; the redaction discipline in the VOs and
 *   the closure-bounded buffer copies in `withBytes` keep the
 *   surface for accidental leaks small.
 */
export class DestroyEncryptionUseCase implements DestroyEncryption {
  public constructor(
    private readonly repository: EncryptionConfigRepository,
    private readonly kdf: Kdf,
    private readonly envelopeCipher: EnvelopeCipher,
    private readonly keyValidator: KeyValidator,
    private readonly clock: Clock,
    private readonly logger: Logger,
    private readonly publishEvent: (event: DomainEvent) => void,
  ) {}

  public async destroy(input: {
    workspaceId: WorkspaceId;
    passphrase: Passphrase;
  }): Promise<
    Result<
      void,
      EncryptionNotInitializedError | KeyValidationFailedError
    >
  > {
    const config = await this.repository.findByWorkspace(input.workspaceId);
    if (config === null) {
      this.logger.warn(
        { workspaceId: input.workspaceId.toString() },
        "encryption destroy rejected: workspace has no encryption slice",
      );
      return err(new EncryptionNotInitializedError(input.workspaceId));
    }

    const envelopes = config.getEnvelopes();
    let authoritativeKey: MasterKey | null = null;
    for (const envelope of envelopes) {
      const candidate = await this.tryUnwrap(envelope, input.passphrase);
      if (candidate === null) continue;

      const accepted = await this.keyValidator.validate(
        config.getKeyValidatorBlob(),
        candidate,
      );
      if (accepted) {
        authoritativeKey = candidate;
        break;
      }
      // Candidate unwrapped but failed the validator: treat as a
      // wrong key (defence in depth — same outcome as
      // UnlockEncryption).
    }

    if (authoritativeKey === null) {
      this.logger.warn(
        { workspaceId: input.workspaceId.toString() },
        "encryption destroy rejected: no key envelope matched the supplied passphrase",
      );
      return err(new KeyValidationFailedError(input.workspaceId));
    }

    // Authoritative key recovered. Discard the reference; the use
    // case does not need the bytes — only the proof-of-ownership.
    authoritativeKey = null;

    await this.repository.delete(input.workspaceId);

    const occurredAt = this.clock.now();
    const event = new EncryptionDestroyed({
      workspaceId: input.workspaceId,
      occurredAt,
    });
    this.publishEvent(event);

    this.logger.info(
      {
        workspaceId: input.workspaceId.toString(),
        envelopeCount: envelopes.length,
      },
      "encryption destroyed",
    );

    return ok(undefined);
  }

  /**
   * Attempts to unwrap one envelope against the supplied passphrase.
   * Returns the candidate master key on success, or `null` on AEAD
   * authentication failure (a normal "wrong key" outcome). Other
   * AEAD failures throw — those signal a broken host, not a wrong
   * key.
   *
   * Mirrors `UnlockEncryptionUseCase.tryUnwrap`. Kept as a
   * private method (not extracted to a shared helper) to honour
   * the project lineamiento about keeping use cases self-contained
   * and avoiding silent coupling.
   */
  private async tryUnwrap(
    envelope: KeyEnvelope,
    passphrase: Passphrase,
  ): Promise<MasterKey | null> {
    const derivation = await this.kdf.derive(passphrase, envelope.kdfParams);
    if (isErr(derivation)) {
      throw derivation.error;
    }
    try {
      return await this.envelopeCipher.unwrap(
        envelope.encryptedMasterKey,
        derivation.value,
      );
    } catch (cause: unknown) {
      if (this.isAuthenticationFailure(cause)) {
        return null;
      }
      throw cause;
    }
  }

  /**
   * Detects the AEAD `authentication-failed` outcome by structural
   * inspection of the thrown error. Avoids importing the concrete
   * `AeadFailedError` class (which lives in `infrastructure/errors/`
   * and would violate the layering rule of `docs/12 §1.1`).
   *
   * The check is conservative: requires a `code` field equal to
   * `"crypto.aead-failed"` AND a `kind` field equal to
   * `"authentication-failed"`. Any other shape is treated as a
   * non-recoverable error and rethrown.
   */
  private isAuthenticationFailure(cause: unknown): boolean {
    if (typeof cause !== "object" || cause === null) return false;
    if (!("code" in cause) || !("kind" in cause)) return false;
    const code: unknown = Reflect.get(cause, "code");
    const kind: unknown = Reflect.get(cause, "kind");
    return code === "crypto.aead-failed" && kind === "authentication-failed";
  }
}
