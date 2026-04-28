import type { Workspace } from "../../../domain/aggregates/workspace.ts";
import type { WorkspaceMode } from "../../../domain/value-objects/workspace-mode.ts";
import type { WorkspacePath } from "../../../domain/value-objects/workspace-path.ts";

/**
 * Driving (input) port for `recall mode <new-mode> --workspace
 * <path>` (`docs/07-instalacion.md` §7,
 * `docs/11-seguridad-modos.md` §5 "Cambios de modo").
 *
 * The use case validates the transition against the aggregate's state
 * machine, applies the corresponding side effects (initialise /
 * destroy the encryption slice, rewrite `.gitignore`), persists the
 * updated config, and returns the mutated aggregate.
 *
 * Pre-conditions per `docs/11-seguridad-modos.md` §5:
 *   - `encrypted -> *` requires the workspace to be unlocked (so the
 *     encryption module can decrypt before destroying the slice). The
 *     use case enforces this by calling `Workspace.assertReadyForUse`
 *     before delegating to the facades.
 *   - `encrypted -> shared` is REJECTED at the aggregate level
 *     (`InvalidModeTransitionError`); the use case relies on the
 *     domain check rather than re-implementing it.
 *
 * Passphrase contract:
 *   `passphrase` is non-null only when `newMode === "encrypted"` and
 *   the bootstrap needs to derive the first envelope. For every other
 *   transition the field is `null`.
 */
export interface ChangeModeInput {
  readonly rootPath: WorkspacePath;
  readonly newMode: WorkspaceMode;
  readonly passphrase: string | null;
}

export interface ChangeModeOutput {
  readonly workspace: Workspace;
}

export interface ChangeMode {
  change(input: ChangeModeInput): Promise<ChangeModeOutput>;
}
