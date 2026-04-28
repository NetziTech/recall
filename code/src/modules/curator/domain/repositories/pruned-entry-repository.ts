import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { MemoryEntryKind } from "../value-objects/memory-entry-kind.ts";
import type { PrunedEntry } from "../value-objects/pruned-entry.ts";

/**
 * Driven port for persisting and reloading `PrunedEntry` snapshots.
 *
 * Mirrors the `pruned` table contract from
 * `docs/03-modelo-datos.md` §4.9: every entry the curator (or the
 * `mem.forget` use case) drops from the live tables is first archived
 * into `pruned` so the audit trail survives for 30 days
 * (`docs/05-memoria-decay.md` §4 — "Pruning preserva audit trail").
 *
 * Contract:
 * - `save(entry)` is append-only. The `pruned` table is never
 *   updated in place; once a snapshot exists, it is read until the
 *   rolling 30-day sweep deletes it. Re-saving the same `(kind, id)`
 *   pair is a logical bug (the underlying entry was already pruned)
 *   — implementations MAY raise a uniqueness violation.
 * - `findById(workspaceId, kind, originalId)` returns the snapshot
 *   for a previously-pruned entry, or `null` when no such entry
 *   exists. The composite key (workspace + kind + original id)
 *   matches the table layout: kind disambiguates id collisions
 *   between aggregates that happen to share a UUID.
 * - `findByWorkspace(workspaceId, limit)` returns the most recent
 *   pruned entries (descending by `prunedAt`), bounded by `limit`.
 *   Used by the audit / restore flows.
 *
 * Errors:
 * - `save` MAY throw on infrastructure-level errors (disk full,
 *   schema drift). The curator's application layer treats such
 *   failures as fatal for the run (the entry stays in the live
 *   table; the next pass tries again).
 * - The query methods MUST NOT throw on "no row found"; they return
 *   `null` / empty array instead.
 */
export interface PrunedEntryRepository {
  save(entry: PrunedEntry): Promise<void>;

  findById(
    workspaceId: WorkspaceId,
    kind: MemoryEntryKind,
    originalId: string,
  ): Promise<PrunedEntry | null>;

  findByWorkspace(
    workspaceId: WorkspaceId,
    limit: number,
  ): Promise<readonly PrunedEntry[]>;
}
