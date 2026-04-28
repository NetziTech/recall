import type { WorkspaceId } from "../../../../../shared/domain/value-objects/workspace-id.ts";

/**
 * Result of an `ExportMemory.export(...)` invocation.
 */
export interface ExportMemoryResult {
  /**
   * Stable, machine-readable schema version of the export envelope.
   * Bumped whenever a breaking change to the JSON shape lands.
   */
  readonly schemaVersion: number;
  readonly workspaceId: WorkspaceId;
  readonly exportedAtMs: number;
  /**
   * UTF-8 JSON document containing every aggregate of the workspace.
   * The use case returns the *string* (not a parsed object) so the CLI
   * can write it straight to disk without a re-serialisation pass.
   */
  readonly json: string;
  /** Per-kind counts for the CLI's progress / summary output. */
  readonly counts: Readonly<{
    decisions: number;
    learnings: number;
    entities: number;
    tasks: number;
    turns: number;
    sessions: number;
    relations: number;
  }>;
}

/**
 * Driving (input) port: serialise the entire memory of a workspace to
 * a portable JSON document.
 *
 * Maps to the CLI's `mcp-memoria export` (`docs/07-instalacion.md`
 * §7.6). The export is the inverse of the import below; the two
 * round-trip with byte-equivalent semantics modulo the
 * implementation-defined ordering of arrays.
 *
 * Out of scope for this use case (intentionally):
 * - Embeddings are NOT included. The vector store is regenerable
 *   from the source rows (`docs/03-modelo-datos.md` §5); duplicating
 *   it would balloon export size for no semantic gain.
 * - Curator runs and pruned-rows audit history are NOT included.
 *   The export is the "live state" of the workspace, not its
 *   operational telemetry.
 * - Secrets audit log is NOT included (`secret_audit_log` rows are
 *   workspace-private telemetry).
 */
export interface ExportMemory {
  export(input: { workspaceId: WorkspaceId }): Promise<ExportMemoryResult>;
}
