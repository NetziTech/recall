import type { WorkspaceId } from "../../../../../shared/domain/value-objects/workspace-id.ts";

/**
 * Driven (output) facade port toward the `encryption` module's
 * `LockEncryption` use case (`recall forget-key`).
 *
 * Outcome contract:
 *   - `locked: true` when the encryption slice was unlocked and the
 *     facade dropped the master key from process memory and from the
 *     on-disk cache.
 *   - `locked: false` with `reason: "already-locked"` when the
 *     workspace was already locked (idempotent success).
 *   - `locked: false` with `reason: "not-encrypted"` when the
 *     workspace is not in encrypted mode (no-op success — the
 *     workspace use case suppresses it as `wasLocked: false`).
 */
export type LockEncryptionFacadeOutcome =
  | { readonly locked: true }
  | {
      readonly locked: false;
      readonly reason: "already-locked" | "not-encrypted";
    };

export interface LockEncryptionFacade {
  lock(input: {
    readonly workspaceId: WorkspaceId;
  }): Promise<LockEncryptionFacadeOutcome>;
}
