import type { Clock } from "../../../../shared/application/ports/clock.port.ts";
import type { Logger } from "../../../../shared/application/ports/logger.port.ts";
import {
  err,
  isErr,
  ok,
  type Result,
} from "../../../../shared/domain/types/result.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { EncryptionConfig } from "../../domain/aggregates/encryption-config.ts";
import { EncryptionNotInitializedError } from "../../domain/errors/encryption-not-initialized-error.ts";
import { KeyValidationFailedError } from "../../domain/errors/key-validation-failed-error.ts";
import type { EnvelopeCipher } from "../../domain/services/envelope-cipher.ts";
import type { KeyValidator } from "../../domain/services/key-validator.ts";
import type { EncryptionConfigRepository } from "../../domain/repositories/encryption-config-repository.ts";
import type { KeyEnvelope } from "../../domain/value-objects/key-envelope.ts";
import type { MasterKey } from "../../domain/value-objects/master-key.ts";
import type { Passphrase } from "../../domain/value-objects/passphrase.ts";
import type { UnlockEncryption } from "../ports/in/unlock-encryption.port.ts";
import type { Kdf } from "../ports/out/kdf.port.ts";

/**
 * Use case: unlock an encrypted workspace.
 *
 * Orchestrates the full unlock flow documented in
 * `docs/11-seguridad-modos.md` §3 / §7. See the input-port JSDoc
 * (`UnlockEncryption`) for the high-level steps.
 *
 * Trial-decryption strategy:
 * - Today the workspace ships with exactly one envelope (multi-key
 *   is v0.5+, see §7 "Multi-key (v0.5+)") but the use case already
 *   walks the envelope list so the v0.5 multi-key flow does not
 *   require a re-architecture.
 * - For each envelope, we re-derive the key against the
 *   per-envelope `kdfParams` (each envelope can carry its own
 *   parameters per `docs/03-modelo-datos.md` §2 "Multi-key"). If
 *   the derivation succeeds, we attempt `EnvelopeCipher.unwrap`. An
 *   AEAD authentication failure means "this passphrase does not
 *   match this envelope" and we move on. Any other AEAD failure
 *   (subtle missing, library error) is rethrown — those signal a
 *   broken host, not a wrong key.
 * - If we collect a candidate `MasterKey`, we hand it to the
 *   aggregate's `unlockWith(...)` which delegates the validator
 *   blob check to the injected `KeyValidator`. If the validator
 *   accepts, the aggregate emits `EncryptionUnlocked` and stores
 *   the master key in memory.
 * - If no envelope produced a valid candidate, we return
 *   `KeyValidationFailedError` (mapped on the wire to
 *   `-32108 INVALID_KEY`).
 *
 * Why we do NOT short-circuit on the first AEAD success without
 * running the validator:
 * - An `AEAD-unwrap` success only proves "this derived key
 *   matches the envelope key the wrap was performed with" — but a
 *   buggy or malicious add-key flow could in theory leave behind
 *   an envelope wrapping the *wrong* master key. The validator
 *   blob check is the second invariant gate that confirms the
 *   recovered master key actually opens THIS workspace.
 *
 * Security:
 * - Logs the unlock event at info level with `workspaceId` and
 *   `keyId` (both public). NEVER logs the passphrase, the derived
 *   key, the master key or the validator plaintext.
 * - Primitive-level KDF / AEAD failures throw via
 *   `EncryptionInfrastructureError`; the use case does NOT swallow
 *   them. Authentication failures during unwrap are caught locally
 *   and folded into the "no envelope matched" outcome.
 */
export class UnlockEncryptionUseCase implements UnlockEncryption {
  public constructor(
    private readonly repository: EncryptionConfigRepository,
    private readonly kdf: Kdf,
    private readonly envelopeCipher: EnvelopeCipher,
    private readonly keyValidator: KeyValidator,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  public async unlock(input: {
    workspaceId: WorkspaceId;
    passphrase: Passphrase;
  }): Promise<
    Result<
      EncryptionConfig,
      EncryptionNotInitializedError | KeyValidationFailedError
    >
  > {
    const config = await this.repository.findByWorkspace(input.workspaceId);
    if (config === null) {
      return err(new EncryptionNotInitializedError(input.workspaceId));
    }

    const envelopes = config.getEnvelopes();
    for (const envelope of envelopes) {
      const candidate = await this.tryUnwrap(envelope, input.passphrase);
      if (candidate === null) continue;

      try {
        await config.unlockWith({
          candidate,
          keyId: envelope.keyId,
          validator: this.keyValidator,
          occurredAt: this.clock.now(),
        });
        await this.repository.save(config);
        this.logger.info(
          {
            workspaceId: input.workspaceId.toString(),
            keyId: envelope.keyId.toString(),
          },
          "encryption unlocked",
        );
        return ok(config);
      } catch (cause: unknown) {
        if (cause instanceof KeyValidationFailedError) {
          // The aggregate raised the validator-blob mismatch; persist
          // the failure event the aggregate buffered so the audit log
          // captures it.
          await this.repository.save(config);
          continue;
        }
        // Any other exception (invariant violation, infra error)
        // bubbles up to the composition root unchanged.
        throw cause;
      }
    }

    this.logger.warn(
      { workspaceId: input.workspaceId.toString() },
      "encryption unlock rejected: no key envelope matched the supplied passphrase",
    );
    return err(new KeyValidationFailedError(input.workspaceId));
  }

  /**
   * Attempts to unwrap one envelope. Returns the candidate master
   * key on success, or `null` on AEAD authentication failure (a
   * normal "wrong key" outcome). Other AEAD failures throw.
   */
  private async tryUnwrap(
    envelope: KeyEnvelope,
    passphrase: Passphrase,
  ): Promise<MasterKey | null> {
    const derivation = await this.kdf.derive(passphrase, envelope.kdfParams);
    if (isErr(derivation)) {
      // The domain VO already enforces the floors; reaching here
      // implies a misconfigured envelope on disk. Surface as a
      // weak-params error to the caller (will be the composition
      // root's responsibility to convert to a fatal log).
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
   * The check is conservative: it requires a `code` field equal to
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
