import type { Workspace } from "../../../domain/aggregates/workspace.ts";
import type { WorkspacePath } from "../../../domain/value-objects/workspace-path.ts";

/**
 * Driving (input) port for the auto-detection flow documented in
 * `docs/01-arquitectura.md` §4 ("Auto-detect upwards from cwd").
 *
 * Walks the filesystem upwards from `startPath` looking for a
 * `.recall/` directory and, when found, rehydrates the
 * `Workspace` aggregate from its `config.json`. The detection
 * intentionally stops at the first match: a project may have its
 * `.recall/` several levels above the current directory but not
 * inside another nested workspace.
 *
 * Reading vs unlocking:
 *   The use case rehydrates the aggregate but does NOT unlock it. The
 *   returned `Workspace` is in the locked state for `encrypted` mode;
 *   the caller (CLI command, MCP tool) decides whether to invoke
 *   `UnlockWorkspaceUseCase` next based on whether the key cache is
 *   populated.
 */
export interface DetectWorkspaceInput {
  /** Path to start walking from (typically `process.cwd()`). */
  readonly startPath: WorkspacePath;
}

export type DetectWorkspaceOutput =
  | { readonly found: true; readonly workspace: Workspace; readonly rootPath: WorkspacePath }
  | { readonly found: false; readonly workspace: null; readonly rootPath: null };

export interface DetectWorkspace {
  detect(input: DetectWorkspaceInput): Promise<DetectWorkspaceOutput>;
}
