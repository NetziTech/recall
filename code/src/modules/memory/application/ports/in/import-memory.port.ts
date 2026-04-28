import type { WorkspaceId } from "../../../../../shared/domain/value-objects/workspace-id.ts";

/**
 * Strategy for handling id collisions during import.
 *
 * Mirrors the conventions used by other tools (`yarn import`, etc.)
 * so the CLI flag is unsurprising:
 *
 * - `skip`     — keep the existing row, drop the imported one.
 * - `replace`  — overwrite the existing row with the imported one.
 * - `error`    — abort the whole import on the first collision (the
 *                use case uses a transaction, so partial writes do not
 *                survive).
 */
export type ImportConflictStrategy = "skip" | "replace" | "error";

/**
 * Result of an `ImportMemory.import(...)` invocation.
 */
export interface ImportMemoryResult {
  readonly workspaceId: WorkspaceId;
  readonly importedAtMs: number;
  readonly counts: Readonly<{
    decisions: number;
    learnings: number;
    entities: number;
    tasks: number;
    turns: number;
    sessions: number;
    relations: number;
  }>;
  /** Number of rows skipped under the `skip` strategy. */
  readonly skipped: number;
  /** Number of rows replaced under the `replace` strategy. */
  readonly replaced: number;
}

/**
 * Driving (input) port: parse a JSON export and persist its contents
 * into the workspace.
 *
 * Maps to the CLI's `mcp-memoria import` (`docs/07-instalacion.md`
 * §7.7). The use case:
 *
 * 1. Validates the envelope (Zod) and the per-aggregate payloads.
 * 2. Honours the `conflictStrategy` for every id collision.
 * 3. Wraps the whole import in a single SQLite transaction so a
 *    failure mid-import leaves the workspace untouched.
 * 4. Re-enqueues embedding jobs for every persisted row whose
 *    `searchable_text` lives in the source data — the worker fills
 *    the vector asynchronously after the import returns.
 *
 * Idempotency:
 * - Two consecutive imports of the same payload under
 *   `conflictStrategy: "skip"` produce identical state. Under
 *   `replace`, the second pass is a no-op (the rows already match);
 *   under `error`, the second pass aborts.
 */
export interface ImportMemory {
  import(input: {
    workspaceId: WorkspaceId;
    json: string;
    conflictStrategy: ImportConflictStrategy;
  }): Promise<ImportMemoryResult>;
}
