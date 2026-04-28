import type { Workspace } from "../../../domain/aggregates/workspace.ts";
import type { WorkspacePath } from "../../../domain/value-objects/workspace-path.ts";

/**
 * Driving (input) port for `recall forget-key --workspace <path>`
 * (`docs/07-instalacion.md` §7 — "Encriptado").
 *
 * Symmetric counterpart of `UnlockWorkspace`. Drops the in-memory key
 * (via `Workspace.lock`) and asks the `LockEncryptionFacade` to wipe
 * the on-disk cache in `~/.config/recall/keys/<workspace_id>.key`
 * — both sides of the lock state must move together. Failing to wipe
 * the cache while flipping the runtime state would leave the next
 * server start in an unlocked state from a key the operator had asked
 * to forget.
 *
 * `wasLocked` is the symmetric counterpart of
 * `UnlockWorkspaceOutput.wasUnlocked`: `true` when the call actually
 * locked a previously unlocked encrypted workspace, `false` for any
 * other (idempotent) outcome.
 */
export interface LockWorkspaceInput {
  readonly rootPath: WorkspacePath;
}

export interface LockWorkspaceOutput {
  readonly workspace: Workspace;
  readonly wasLocked: boolean;
}

export interface LockWorkspace {
  lock(input: LockWorkspaceInput): Promise<LockWorkspaceOutput>;
}
