import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { CommandHistory } from "../aggregates/command-history.ts";

/**
 * Driven (output) port for persisting `CommandHistory` aggregates.
 *
 * The interface lives in the domain so the aggregate can be saved and
 * loaded without knowing whether the implementation is SQLite, an
 * in-memory map, a JSON file, or anything else. The infrastructure
 * layer provides a concrete adapter (`SqliteCommandHistoryRepository`,
 * `InMemoryCommandHistoryRepository`, etc.) that the composition root
 * wires to this contract.
 *
 * Cardinality:
 * - One `CommandHistory` per `WorkspaceId`. The repository is therefore
 *   keyed by workspace, not by execution.
 *
 * Method contract:
 *
 *   - `findById(id)` returns the aggregate if it exists, or `null`. It
 *     never throws on "not found" — the absence of a history is a
 *     legitimate state for a fresh workspace.
 *   - `save(history)` persists the *whole* aggregate (capacity +
 *     buffer). The implementation must be transactional: a partial
 *     write that left the on-disk buffer in an out-of-order state
 *     would silently break `CommandHistory.rehydrate`'s invariant
 *     check. Repeated `save(history)` calls with the same aggregate
 *     are idempotent (last-write-wins on the buffer contents).
 *   - `delete(id)` removes the aggregate. Used by `recall wipe`
 *     and during workspace teardown. Calling `delete` for a workspace
 *     with no history is a no-op (no error).
 *
 * The interface intentionally does NOT expose ad-hoc query methods
 * (`findExecutionsByName`, `searchByDateRange`, ...). Per the project
 * lineamiento on repositories
 * (`docs/12-lineamientos-arquitectura.md` §1.3 and §1.5), repositories
 * deal with full aggregates; querying is a concern of dedicated read
 * models (none needed here).
 */
export interface CommandHistoryRepository {
  /**
   * Looks up the history for `id`. Returns `null` if no history has
   * ever been persisted for that workspace.
   */
  findById(id: WorkspaceId): Promise<CommandHistory | null>;

  /**
   * Persists the full aggregate. The implementation overwrites any
   * previously stored state for the same workspace id.
   */
  save(history: CommandHistory): Promise<void>;

  /**
   * Removes the aggregate. No-op when nothing was previously stored.
   */
  delete(id: WorkspaceId): Promise<void>;
}
