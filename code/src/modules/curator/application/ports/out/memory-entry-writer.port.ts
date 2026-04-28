import type { Confidence } from "../../../../../shared/domain/value-objects/confidence.ts";
import type { Timestamp } from "../../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../../shared/domain/value-objects/workspace-id.ts";
import type { MemoryEntryKind } from "../../../domain/value-objects/memory-entry-kind.ts";

/**
 * Driven (output) port that mutates memory entries on the curator's
 * behalf.
 *
 * The curator MUST go through this port (instead of importing each
 * kind-specific repository directly from `memory/domain`) for two
 * reasons:
 *
 * 1. ISP: the curator only needs three operations
 *    (`applyDecay`, `markPruned`, `tagAsStale`); a single narrow
 *    port keeps the test surface small.
 * 2. The implementation is a single SQLite-backed adapter
 *    (`SqliteMemoryEntryWriter` in
 *    `modules/curator/infrastructure/persistence/`). The adapter
 *    routes each call to the right kind-specific table via prepared
 *    statements; the curator does not need to know about the
 *    routing.
 *
 * Cross-import note: the CONCRETE adapter resides inside
 * `modules/curator/infrastructure/persistence/` and may reach into
 * `memory/domain` (ADR-001) to reuse kind-specific id parsers if
 * the adapter chooses to do so. This port itself stays free of
 * cross-module imports.
 *
 * Concurrency:
 * - All three methods are atomic at the SQL-statement level. The
 *   curator's orchestrator wraps grouped mutations in a single
 *   transaction via `DatabaseConnection.transaction(...)` so partial
 *   failures roll back cleanly.
 */
export interface MemoryEntryWriter {
  /**
   * Sets the entry's confidence to `newConfidence`. Used by the
   * decay pass after `DecayCalculator.newConfidence(...)`. The call
   * does NOT touch `last_used_ms` — decay is a side-effect of time
   * passing, not of the entry being surfaced.
   *
   * Implementations MAY skip the UPDATE when the supplied
   * confidence equals the persisted one (no-op fast path); the
   * curator counts only the actual changes.
   *
   * Returns `true` if the row was updated, `false` if no change was
   * needed (the persisted confidence already matched).
   *
   * Performance: prefer `applyDecayBatch(...)` for bulk passes; per-
   * row UPDATEs outside a transaction pay one WAL fsync each, which
   * dominates the curator's time budget on 50K-row workspaces.
   */
  applyDecay(input: {
    workspaceId: WorkspaceId;
    kind: MemoryEntryKind;
    entryId: string;
    newConfidence: Confidence;
  }): Promise<boolean>;

  /**
   * Applies many decays atomically. Implementations MUST wrap every
   * UPDATE in a single SQL transaction so the bulk pass pays one
   * fsync (instead of N) and so a mid-batch failure rolls back every
   * preceding write. The order of `items` is preserved; per-kind
   * dispatch is the adapter's responsibility.
   *
   * Returns the number of rows that actually changed (rows whose
   * persisted confidence differed from the supplied value). The
   * curator uses this counter to fold into `CuratorRunStats`.
   *
   * Why a separate batch method (instead of "use the per-row method
   * inside a transaction at the use-case level"):
   * - `DatabaseConnection.transaction(fn)` is synchronous; the
   *   `MemoryEntryWriter` interface is async. The adapter is the
   *   only layer that can bridge the two without leaking the sync
   *   constraint into the application layer.
   */
  applyDecayBatch(input: {
    workspaceId: WorkspaceId;
    items: readonly {
      readonly kind: MemoryEntryKind;
      readonly entryId: string;
      readonly newConfidence: Confidence;
    }[];
  }): Promise<number>;

  /**
   * Tags an entity as stale (per `docs/05-memoria-decay.md` §5
   * Caso 1): adds the `stale` tag to the entity's `tags_json` column
   * AND halves the entity's confidence. Atomic via a single UPDATE.
   *
   * Returns `true` if the entity was updated, `false` if it was
   * already tagged stale (idempotent re-tag).
   */
  tagEntityAsStale(input: {
    workspaceId: WorkspaceId;
    entityId: string;
  }): Promise<boolean>;

  /**
   * Atomically:
   * 1. Inserts a row into `pruned` (kind, id, content snapshot,
   *    reason, prunedAt).
   * 2. Deletes the live row from the kind-specific table.
   *
   * Both writes share a single SQL transaction in the adapter so
   * neither side can survive without the other. Idempotent: if the
   * live row was already deleted, the method returns `false` without
   * touching `pruned`.
   *
   * Returns `true` if the entry was actually pruned, `false` if it
   * had already been pruned (idempotent re-prune).
   */
  markPruned(input: {
    workspaceId: WorkspaceId;
    kind: MemoryEntryKind;
    entryId: string;
    contentSnapshot: string;
    reasonKind: "low_confidence" | "manual" | "consolidated_into_other" | "obsoleted";
    prunedAt: Timestamp;
  }): Promise<boolean>;
}
