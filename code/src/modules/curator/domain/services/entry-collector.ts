import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { AffectedEntryRef } from "../value-objects/affected-entry-ref.ts";
import type { MemoryEntryKind } from "../value-objects/memory-entry-kind.ts";

/**
 * Driven port (output port) used by the curator to enumerate every
 * memory entry the workspace owns, kind by kind.
 *
 * The curator needs to iterate over `decisions`, `learnings`,
 * `entities`, `tasks`, `turns` to apply decay and pick consolidation
 * /pruning candidates (`docs/05-memoria-decay.md` §6 — "Pasada
 * completa", steps 2 and 7). Implementing the iteration here directly
 * would force the curator domain to import every kind-specific
 * repository, breaking the per-module aggregate ownership rule.
 *
 * Instead, the application/infrastructure layer provides an
 * `EntryCollector` adapter that wraps the relevant memory repositories
 * and exposes a single, kind-agnostic enumeration. The curator only
 * sees `(kind, id)` references; loading the full aggregate is the
 * responsibility of the kind-specific repository, called by the
 * application layer when an event handler needs the full row.
 *
 * Contract:
 * - `listAllByKind(workspaceId, kind)` returns every entry of `kind`
 *   in the workspace, including consolidated learnings and
 *   superseded decisions. The curator decides which subset to act on
 *   based on its own policies (`PruneThreshold`,
 *   `ConsolidationThreshold`, `MaxEntriesPerKind`).
 * - The order is unspecified — the curator does not depend on it.
 *   Implementations MAY sort by id (UUID v7 = chronological) for
 *   stability, but callers MUST NOT rely on it.
 * - The method is `Promise`-typed because realistic implementations
 *   will hit SQLite (asynchronous in our infrastructure adapters).
 *
 * Errors:
 * - The implementation MAY throw on transport failures (locked DB,
 *   I/O error). The curator's application layer catches and turns
 *   them into a finding (`embedding_drift` is the closest existing
 *   bucket, but a future revision may add an `enumeration_failed`
 *   kind).
 */
export interface EntryCollector {
  listAllByKind(
    workspaceId: WorkspaceId,
    kind: MemoryEntryKind,
  ): Promise<readonly AffectedEntryRef[]>;
}
