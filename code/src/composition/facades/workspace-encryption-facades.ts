/**
 * Cross-module facade adapters that wrap `encryption` module use
 * cases in the workspace module's `*EncryptionFacade` driven ports.
 *
 * Why these adapters live in `composition/`:
 * - The workspace module declares the facade ports
 *   (`InitializeEncryptionFacade`, `UnlockEncryptionFacade`,
 *   `LockEncryptionFacade`, `DestroyEncryptionFacade`) precisely so
 *   it does not import encryption-domain types. The composition
 *   root is the one place allowed to wire both modules together
 *   (`docs/12 §1.5` Regla 4).
 *
 * Mapping rules:
 *   - The workspace passes `passphrase: string`. The adapter wraps
 *     it in `Passphrase.from(...)` at the boundary.
 *   - The encryption use case returns `EncryptionConfig` /
 *     `Result<EncryptionConfig, ...>`. The workspace facade returns
 *     either `void` (init / destroy) or the discriminated outcome
 *     (`unlock`/`lock`).
 *   - For `init` and `destroy`, recoverable errors propagate
 *     unchanged so the workspace mode-change use case can surface
 *     the typed failure to the CLI handler. The `destroy` adapter
 *     unwraps the `Result<void, ...>` returned by the use case: on
 *     success it returns `void`; on the recoverable error channel
 *     (wrong passphrase / not initialised) it throws so the
 *     workspace flow aborts before flipping the aggregate's mode.
 *   - For `unlock`, AEAD authentication failures fold into
 *     `{ unlocked: false, reason: "key-validation-failed" }`.
 */

import { isErr } from "../../shared/domain/types/result.ts";
import type { WorkspaceId } from "../../shared/domain/value-objects/workspace-id.ts";
import type { DestroyEncryption } from "../../modules/encryption/application/ports/in/destroy-encryption.port.ts";
import type { InitializeEncryption } from "../../modules/encryption/application/ports/in/initialize-encryption.port.ts";
import type { LockEncryption } from "../../modules/encryption/application/ports/in/lock-encryption.port.ts";
import type { UnlockEncryption } from "../../modules/encryption/application/ports/in/unlock-encryption.port.ts";
import { KeyValidationFailedError } from "../../modules/encryption/domain/errors/key-validation-failed-error.ts";
import { Passphrase } from "../../modules/encryption/domain/value-objects/passphrase.ts";
import type { DestroyEncryptionFacade } from "../../modules/workspace/application/ports/out/destroy-encryption-facade.port.ts";
import type { InitializeEncryptionFacade } from "../../modules/workspace/application/ports/out/initialize-encryption-facade.port.ts";
import type {
  LockEncryptionFacade,
  LockEncryptionFacadeOutcome,
} from "../../modules/workspace/application/ports/out/lock-encryption-facade.port.ts";
import type {
  UnlockEncryptionFacade,
  UnlockEncryptionFacadeOutcome,
} from "../../modules/workspace/application/ports/out/unlock-encryption-facade.port.ts";

/**
 * Adapter for `InitializeEncryptionFacade`. Wraps the raw passphrase
 * in `Passphrase.from(...)` and forwards.
 */
export class InitializeEncryptionFacadeAdapter implements InitializeEncryptionFacade {
  public constructor(private readonly useCase: InitializeEncryption) {}

  public async initialize(input: {
    workspaceId: WorkspaceId;
    passphrase: string;
  }): Promise<void> {
    const passphrase = Passphrase.from(input.passphrase);
    await this.useCase.initialize({
      workspaceId: input.workspaceId,
      passphrase,
    });
  }
}

/**
 * Adapter for `UnlockEncryptionFacade`. Wraps the passphrase, runs
 * the use case, and folds the `Result` into the workspace's
 * outcome shape.
 *
 * The "passphrase: null" path of the workspace contract is reserved
 * for "read the cached key from `~/.config/recall/keys/...`".
 * The encryption module does not implement that cache path yet;
 * the adapter surfaces the case as `key-validation-failed` so the
 * workspace handler prompts the user (the CLI passes the typed
 * passphrase explicitly).
 */
export class UnlockEncryptionFacadeAdapter implements UnlockEncryptionFacade {
  public constructor(private readonly useCase: UnlockEncryption) {}

  public async unlock(input: {
    workspaceId: WorkspaceId;
    passphrase: string | null;
  }): Promise<UnlockEncryptionFacadeOutcome> {
    if (input.passphrase === null) {
      // Key cache lookup is Fase 5 work; today the workspace use case
      // is invoked with a typed passphrase. Surface as
      // `key-validation-failed` so the caller falls back to the
      // interactive prompt.
      return { unlocked: false, reason: "key-validation-failed" };
    }
    const passphrase = Passphrase.from(input.passphrase);
    const result = await this.useCase.unlock({
      workspaceId: input.workspaceId,
      passphrase,
    });
    if (isErr(result)) {
      if (result.error instanceof KeyValidationFailedError) {
        return { unlocked: false, reason: "key-validation-failed" };
      }
      // EncryptionNotInitializedError → workspace and encryption
      // module disagree; surface as not-encrypted so the workspace
      // use case logs and treats as no-op.
      return { unlocked: false, reason: "not-encrypted" };
    }
    return { unlocked: true };
  }
}

/**
 * Adapter for `LockEncryptionFacade`. The encryption use case
 * returns `Result<void, EncryptionNotInitializedError>`; the adapter
 * folds the success and error channels into the workspace's
 * discriminated outcome.
 */
export class LockEncryptionFacadeAdapter implements LockEncryptionFacade {
  public constructor(private readonly useCase: LockEncryption) {}

  public async lock(input: {
    workspaceId: WorkspaceId;
  }): Promise<LockEncryptionFacadeOutcome> {
    const result = await this.useCase.lock({ workspaceId: input.workspaceId });
    if (isErr(result)) {
      return { locked: false, reason: "not-encrypted" };
    }
    return { locked: true };
  }
}

/**
 * Adapter for `DestroyEncryptionFacade`. Wraps the `passphrase`
 * string in `Passphrase.from(...)` and forwards to the encryption
 * module's `DestroyEncryptionUseCase`.
 *
 * Result mapping:
 *   - `ok(undefined)` (success) → resolves with `void`. The workspace
 *     use case then flips the aggregate's mode and persists.
 *   - `err(KeyValidationFailedError | EncryptionNotInitializedError)`
 *     → throws the underlying error. The workspace use case treats
 *     this as a hard abort (mode is NOT flipped) and surfaces the
 *     typed failure to the CLI handler. The handler maps it onto
 *     the user-facing message documented in
 *     `docs/11-seguridad-modos.md` §5 ("passphrase incorrecta /
 *     workspace ya no encriptado").
 *
 * Authority gate:
 *   - The encryption module re-derives a key from the passphrase and
 *     re-validates ownership before deleting anything. The workspace
 *     module's `assertReadyForUse` check (the in-memory unlock flag)
 *     is NOT a sufficient proof for an irrecoverable operation.
 */
export class DestroyEncryptionFacadeAdapter implements DestroyEncryptionFacade {
  public constructor(private readonly useCase: DestroyEncryption) {}

  public async destroy(input: {
    workspaceId: WorkspaceId;
    targetMode: "shared" | "private";
    passphrase: string;
  }): Promise<void> {
    void input.targetMode;
    const passphrase = Passphrase.from(input.passphrase);
    const result = await this.useCase.destroy({
      workspaceId: input.workspaceId,
      passphrase,
    });
    if (isErr(result)) {
      // Recoverable failures bubble as typed exceptions. The
      // workspace use case logs and aborts the transition.
      throw result.error;
    }
  }
}
