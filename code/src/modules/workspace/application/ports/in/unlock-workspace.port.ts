import type { Workspace } from "../../../domain/aggregates/workspace.ts";
import type { WorkspacePath } from "../../../domain/value-objects/workspace-path.ts";

/**
 * Driving (input) port for `recall unlock --workspace <path>`
 * (`docs/07-instalacion.md` §7 — "Encriptado") and the implicit unlock
 * the runtime performs at server start when the key cache in
 * `~/.config/recall/keys/<workspace_id>.key` is populated
 * (`docs/11-seguridad-modos.md` §3 "Sesiones siguientes").
 *
 * Orchestration:
 *   1. Detect the workspace at `rootPath` and rehydrate the aggregate.
 *   2. If the workspace is not in `encrypted` mode, return it
 *      unchanged with `wasUnlocked === false`. This is a no-op
 *      success: callers on shared/private workspaces invoke `unlock`
 *      defensively at startup and expect it to succeed.
 *   3. For encrypted workspaces, delegate to the
 *      `UnlockEncryptionFacade` to derive the key, validate it,
 *      cache it in HOME, and stamp the aggregate as unlocked.
 *
 * The passphrase is `string | null`: `null` instructs the facade to
 * try the key cached on disk in HOME (interactive flow). A non-null
 * value means the operator typed the passphrase manually and is
 * passed through to the encryption module.
 */
export interface UnlockWorkspaceInput {
  readonly rootPath: WorkspacePath;
  readonly passphrase: string | null;
}

export interface UnlockWorkspaceOutput {
  readonly workspace: Workspace;
  /**
   * `true` iff the call actually unlocked an encrypted workspace.
   * `false` for already-unlocked workspaces and for shared/private
   * modes (where unlocking is a no-op).
   */
  readonly wasUnlocked: boolean;
}

export interface UnlockWorkspace {
  unlock(input: UnlockWorkspaceInput): Promise<UnlockWorkspaceOutput>;
}
