import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import { EncryptionDomainError } from "./encryption-domain-error.ts";

/**
 * Raised when an operation requiring an initialized
 * `EncryptionConfig` is attempted on a workspace that has none.
 *
 * Examples:
 * - The CLI calls `recall add-key --workspace .` on a workspace
 *   whose mode is `shared` or `private` (no encryption config exists).
 * - A use case attempts to `unlockWith(masterKey)` before the
 *   aggregate has been initialized.
 *
 * This is distinct from `WorkspaceLockedError` (which signals "the
 * encryption is initialized but no key is currently loaded"): here
 * the encryption config simply does not exist yet, and the caller's
 * next move is typically `mem.init({ mode: "encrypted" })` or a
 * mode transition.
 *
 * Invariants:
 * - `code` is the stable identifier `encryption.not-initialized`.
 * - `workspaceId` identifies the offending workspace.
 * - `jsonRpcCode` is `null`: the protocol catalog does not allocate
 *   a dedicated code; adapters typically map this to
 *   `INVALID_PARAMS` or surface a CLI-level message.
 */
export class EncryptionNotInitializedError extends EncryptionDomainError {
  public readonly code = "encryption.not-initialized";
  public readonly jsonRpcCode: number | null = null;
  public readonly workspaceId: WorkspaceId;

  public constructor(workspaceId: WorkspaceId, options?: { cause?: unknown }) {
    super(
      `encryption is not initialized for workspace ${workspaceId.toString()}; call mem.init with mode "encrypted" first`,
      options !== undefined ? { cause: options.cause } : undefined,
    );
    this.workspaceId = workspaceId;
  }
}
