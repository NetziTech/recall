import type { DatabaseConnection } from "../../../../shared/application/ports/database-connection.port.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type {
  MemoryWipeOutcome,
  MemoryWiper,
} from "../../application/ports/out/memory-wiper.port.ts";
import { MemoryInfrastructureError } from "../errors/memory-infrastructure-error.ts";

/**
 * Set of tables the wipe clears. Order matters when foreign keys are
 * enforced: children before parents. The SQL statements use plain
 * `DELETE`; SQLite's FTS5 shadow tables for `turns`, `decisions`,
 * `learnings`, and `entities` are kept in sync by the triggers in
 * `code/migrations/004__core-memory-schema.sql`.
 */
const WIPE_SQL_STATEMENTS: readonly string[] = Object.freeze([
  // Memory-owned tables (children first):
  `DELETE FROM relations`,
  `DELETE FROM turns`,
  `DELETE FROM tasks`,
  `DELETE FROM entities`,
  `DELETE FROM learnings`,
  `DELETE FROM decisions`,
  `DELETE FROM sessions`,
  // Retrieval-owned tables that point back at memory rows:
  `DELETE FROM embedding_queue`,
  `DELETE FROM embedding_metadata`,
  // The vec0 virtual table requires a different DELETE shape (no WHERE
  // clause is allowed without a partition selector). Per the
  // sqlite-vec docs, a full clear is achieved via the rowid range
  // syntax; an empty `embeddings` table is acceptable to leave behind
  // when the vector store has only a few rows.
  // The WHERE-id-IN-(SELECT id FROM embedding_metadata) form would be
  // empty after the previous DELETE, so an unconditional `DELETE FROM
  // embeddings` is the correct sequence.
  `DELETE FROM embeddings`,
]);

/**
 * SQLite-backed adapter for `MemoryWiper`.
 *
 * Wraps every DELETE in a single transaction so the workspace either
 * stays untouched or comes back empty — there is no partial-wipe
 * intermediate state.
 *
 * Curator-owned tables (`pruned`, `curator_runs`) are intentionally
 * preserved (per `WipeMemoryUseCase` JSDoc).
 */
export class SqliteMemoryWiper implements MemoryWiper {
  public constructor(
    private readonly db: DatabaseConnection,
    private readonly workspaceId: WorkspaceId,
  ) {}

  public async wipe(input: {
    workspaceId: WorkspaceId;
  }): Promise<MemoryWipeOutcome> {
    if (!input.workspaceId.equals(this.workspaceId)) {
      throw MemoryInfrastructureError.deleteFailed(
        "memory_wipe",
        new Error(
          `workspace mismatch: adapter pinned to ${this.workspaceId.toString()} but caller passed ${input.workspaceId.toString()}`,
        ),
      );
    }

    let totalDeleted = 0;
    try {
      this.db.transaction((): void => {
        for (const sql of WIPE_SQL_STATEMENTS) {
          const stmt = this.db.prepare(sql);
          const result = stmt.run();
          totalDeleted += result.changes;
        }
      });
    } catch (cause: unknown) {
      throw MemoryInfrastructureError.deleteFailed("memory_wipe", cause);
    }

    return Promise.resolve({ rowsDeleted: totalDeleted });
  }
}
