import type { WorkspaceId } from "../../../../../shared/domain/value-objects/workspace-id.ts";
import type { WorkspacePath } from "../../../domain/value-objects/workspace-path.ts";

/**
 * Driving (input) port for the destructive `mcp-memoria wipe` flow
 * documented in `docs/07-instalacion.md` §7 ("wipe").
 *
 * Semantics (confirmed by the Tarea 5.2 integration tests pin):
 *   - Truncates every memory-owned SQL table (decisions, learnings,
 *     entities, tasks, turns, sessions, relations, plus the
 *     retrieval pipeline's `embedding_queue` / `embedding_metadata` /
 *     `embeddings` shadows).
 *   - For encrypted workspaces: locks first (via the encryption
 *     module) so the on-disk key cache is invalidated before the
 *     directory disappears.
 *   - Removes the entire `<root>/.mcp-memoria/` directory tree
 *     recursively.
 *   - Emits `WorkspaceDestroyed` so subscribers (audit log, telemetry)
 *     can record the wipe.
 *
 * Confirmation gate:
 *   - The port REQUIRES `confirmed === true` from the caller; the
 *     use case raises `InvalidInputError` otherwise. This is the
 *     last-line defense against accidental invocation: the CLI
 *     handler enforces the literal `WIPE` confirmation prompt
 *     (or `--confirm` flag) one layer up, but a bug in that layer
 *     should still not result in unilateral data loss. The two
 *     gates are independent.
 *
 * Idempotency:
 *   - A wipe of a non-existent workspace surfaces a typed
 *     `NoWorkspaceAtPathError` rather than a silent success: the
 *     CLI prints "no hay nada que borrar" and exits with the
 *     usage-error code so the operator notices the mistake.
 */
export interface DestroyWorkspaceInput {
  /** Absolute root of the host project. */
  readonly rootPath: WorkspacePath;
  /**
   * Explicit confirmation that the caller has obtained operator
   * consent (CLI: typed `WIPE` literal or `--confirm` flag). The use
   * case raises `InvalidInputError` when this is false.
   */
  readonly confirmed: boolean;
}

export interface DestroyWorkspaceOutput {
  /** Identity of the workspace that was destroyed. */
  readonly workspaceId: WorkspaceId;
  /** Absolute path of the directory that was removed. */
  readonly removedPath: string;
  /** Number of memory rows truncated by the embedded `WipeMemory` step. */
  readonly rowsDeleted: number;
}

export interface DestroyWorkspace {
  destroy(input: DestroyWorkspaceInput): Promise<DestroyWorkspaceOutput>;
}
