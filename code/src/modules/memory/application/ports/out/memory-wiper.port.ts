import type { WorkspaceId } from "../../../../../shared/domain/value-objects/workspace-id.ts";

/**
 * Result of a `MemoryWiper.wipe(...)` call.
 */
export interface MemoryWipeOutcome {
  readonly rowsDeleted: number;
}

/**
 * Driven (output) port: erase every memory row in the workspace.
 *
 * The implementation runs a single SQLite transaction that DELETEs
 * from every memory-owned table (`decisions`, `learnings`, `entities`,
 * `relations`, `tasks`, `turns`, `sessions`) plus the retrieval-owned
 * tables that point back at memory rows (`embeddings`,
 * `embedding_metadata`, `embedding_queue`). Curator-owned tables
 * (`pruned`, `curator_runs`) are intentionally PRESERVED so the
 * operator can inspect what was there.
 */
export interface MemoryWiper {
  wipe(input: { workspaceId: WorkspaceId }): Promise<MemoryWipeOutcome>;
}
