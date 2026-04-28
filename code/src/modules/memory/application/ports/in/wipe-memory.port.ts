import type { WorkspaceId } from "../../../../../shared/domain/value-objects/workspace-id.ts";

/**
 * Result of a `WipeMemory.wipe(...)` invocation.
 */
export interface WipeMemoryResult {
  readonly workspaceId: WorkspaceId;
  readonly wipedAtMs: number;
  /** Total rows deleted across every kind. */
  readonly rowsDeleted: number;
}

/**
 * Driving (input) port: erase every memory row in the workspace.
 *
 * Maps to the CLI's `mcp-memoria wipe` (`docs/07-instalacion.md`
 * §7.9). The CLI parser is the layer that enforces the `WIPE` literal
 * confirmation; this use case trusts the caller and proceeds.
 *
 * Scope:
 * - DELETE every row from: `decisions`, `learnings`, `entities`,
 *   `relations`, `tasks`, `turns`, `sessions`. The FTS5 shadows are
 *   cleared by the migration triggers (DELETE on the base table
 *   cascades into the shadow).
 * - Curator-owned tables (`pruned`, `curator_runs`) are
 *   intentionally OUT of scope: the curator's audit trail survives a
 *   wipe so the operator can inspect what was there.
 * - Retrieval-owned tables (`embeddings`, `embedding_metadata`,
 *   `embedding_queue`) are CLEARED so a stale vector cannot point at
 *   a deleted row.
 *
 * Atomicity:
 * - The whole wipe runs inside a single SQLite transaction. A failure
 *   leaves the workspace untouched.
 *
 * Side effects:
 * - Emits NO domain event. A wipe is an operational reset, not a
 *   business fact; flooding the bus with thousands of `*Deleted`
 *   events would not help any subscriber.
 */
export interface WipeMemory {
  wipe(input: { workspaceId: WorkspaceId }): Promise<WipeMemoryResult>;
}
