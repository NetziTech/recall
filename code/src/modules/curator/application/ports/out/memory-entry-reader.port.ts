import type { Confidence } from "../../../../../shared/domain/value-objects/confidence.ts";
import type { Timestamp } from "../../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../../shared/domain/value-objects/workspace-id.ts";
import type { LearningSeverity } from "../../../../memory/domain/value-objects/learning-severity.ts";
import type { MemoryEntryKind } from "../../../domain/value-objects/memory-entry-kind.ts";

/**
 * Read-only projection of a memory entry, enriched with the fields
 * the curator's decay/prune passes need.
 *
 * Why a flat projection (not a full aggregate):
 * - The curator's domain VO catalog (`MemoryEntryKind`,
 *   `DecayFactor`, `PruneThreshold`, `ConsolidationThreshold`) is
 *   built around a `(kind, id, confidence, lastUsedMs, useCount,
 *   ...)` tuple. Loading every aggregate just to call a static
 *   method on the calculator and a setter on the writer would
 *   triple the I/O cost of the pass.
 * - The single exception is `Learning`, which the consolidation
 *   step needs as a full aggregate (the loser's
 *   `consolidateInto(...)` mutation is performed on the aggregate,
 *   not on a projection). That use case bypasses this projection
 *   and goes through the existing `LearningRepository` (cross-import
 *   to `memory/domain` authorised by ADR-001).
 *
 * The `severity` field is non-null only for `learning` entries; it
 * mirrors the discriminator the curator's domain accepts in
 * `DecayFactor.forKind(kind, severity)`.
 *
 * The `tags` field is a frozen string array (not the `Tags` VO) so
 * the projection stays portable across the cross-module boundary
 * without forcing this port to import the `Tags` constructor for
 * every read.
 */
export interface MemoryEntryProjection {
  readonly workspaceId: WorkspaceId;
  readonly kind: MemoryEntryKind;
  readonly id: string;
  readonly confidence: Confidence;
  readonly lastUsedMs: number;
  readonly useCount: number;
  readonly createdAt: Timestamp;
  readonly severity: LearningSeverity | null;
  readonly tags: readonly string[];
  /**
   * The serialised content used as the `content_snapshot` when the
   * entry is pruned. The reader produces it; the curator does not
   * inspect its shape.
   */
  readonly contentSnapshot: string;
}

/**
 * Driven (output) port that surfaces every memory entry the curator
 * needs to inspect.
 *
 * The adapter (`SqliteMemoryEntryReader` in
 * `modules/curator/infrastructure/persistence/`) joins the
 * kind-specific tables (`decisions`, `learnings`, `entities`,
 * `tasks`, `turns`) into a single unified projection.
 *
 * Cross-import note:
 * - The adapter's CONCRETE class must reach into `memory/domain` to
 *   reconstruct kind-specific VOs (`LearningSeverity`,
 *   `DecisionId`, ...). This cross-import is authorised by
 *   ADR-001 (`docs/12-lineamientos-arquitectura.md` §1.5.1).
 * - The PORT itself stays light by only naming `LearningSeverity`
 *   among the cross-module types (the only one that drives a
 *   curator-domain decision); the rest of the per-kind VOs stay
 *   inside the adapter.
 */
export interface MemoryEntryReader {
  /**
   * Returns every active entry (`consolidatedInto IS NULL` for
   * learnings, `endedAt IS NULL` for sessions, etc.) of `kind` in
   * `workspaceId`, eagerly.
   *
   * Why eager (not a cursor / async iterator):
   * - The curator's only consumer is `ApplyDecayUseCase`, which
   *   issues per-row UPDATEs after computing a decay factor. On
   *   `better-sqlite3-multiple-ciphers` (and on plain better-sqlite3),
   *   issuing a write while a read iterator is still open on the
   *   same connection raises `TypeError: This database connection is
   *   busy executing a query` (the C++
   *   `REQUIRE_DATABASE_NO_ITERATORS_UNLESS_UNSAFE` macro). Returning
   *   a frozen array forces the cursor to close before the writer
   *   runs. See `apply-decay.use-case.ts` JSDoc for the full
   *   rationale (Bug F, Tarea 5.4).
   * - `ConsolidateSimilarUseCase` already needed the eager list (its
   *   `SimilarityFinder` is O(n²)), so this is the canonical shape
   *   for every curator pass.
   *
   * Memory cost: a 50K-row workspace materialises ~5–10 MB of
   * projections at peak — within the curator's process budget.
   *
   * Caller MUST limit the input by `MaxEntriesPerKind` before
   * calling if it cannot afford the full set — the adapter does not
   * enforce a cap.
   */
  listActiveByKind(input: {
    workspaceId: WorkspaceId;
    kind: MemoryEntryKind;
  }): Promise<readonly MemoryEntryProjection[]>;

  /**
   * Returns every active entry that qualifies for pruning per the
   * spec in `docs/05-memoria-decay.md` §4: `confidence < threshold`,
   * `use_count == 0`, `created_at_ms <= cutoffMs`. The adapter
   * applies all three predicates in the SQL `WHERE` clause to keep
   * the scan tight.
   *
   * Only kinds in `pruneableKinds` are considered. The curator
   * passes `[learning, turn]` per the policy in
   * `docs/05-memoria-decay.md` §4 (decisions and entities are not
   * auto-pruned; tasks are an open enum and are skipped).
   */
  listPruneCandidates(input: {
    workspaceId: WorkspaceId;
    pruneableKinds: readonly MemoryEntryKind[];
    confidenceBelow: Confidence;
    cutoffMs: number;
  }): Promise<readonly MemoryEntryProjection[]>;

  /**
   * Returns every entity-kind entry whose persisted `location` field
   * is not null. Used by the path-stale self-heal pass. Each
   * projection's `contentSnapshot` carries the location string for
   * convenience; the structured `path` field lives next to it.
   */
  listEntityLocations(input: {
    workspaceId: WorkspaceId;
  }): Promise<readonly EntityLocationProjection[]>;
}

/**
 * Projection used by the path-stale self-heal pass. Carries the
 * entity id, the raw location string, and the workspace id (for the
 * adapter's transaction scope). The curator does NOT load the full
 * `Entity` aggregate here — it only needs to know which paths to
 * probe and which entity to tag if the probe fails.
 */
export interface EntityLocationProjection {
  readonly workspaceId: WorkspaceId;
  readonly entityId: string;
  readonly location: string;
}
