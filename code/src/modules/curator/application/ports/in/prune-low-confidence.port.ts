import type { WorkspaceId } from "../../../../../shared/domain/value-objects/workspace-id.ts";
import type { CuratorRunId } from "../../../domain/value-objects/curator-run-id.ts";
import type { PruneThreshold } from "../../../domain/value-objects/prune-threshold.ts";

/**
 * Outcome of one `PruneLowConfidence` invocation.
 *
 * `entriesPruned` counts the rows moved to the `pruned` table. The use
 * case may scan more entries than it prunes (an entry below threshold
 * but with `use_count > 0` or `created_at_ms > now() - 30 days` stays
 * in the live table — see the `WHERE` predicates in
 * `docs/05-memoria-decay.md` §4).
 */
export interface PruneLowConfidenceResult {
  readonly runId: CuratorRunId;
  readonly entriesPruned: number;
}

/**
 * Driving (input) port: drop low-confidence entries from the live
 * tables, archiving them to `pruned` for a 30-day audit window.
 *
 * Mirrors the pruning step (#7) of the curator pass documented in
 * `docs/05-memoria-decay.md` §6 ("Pasada completa") and the policy in
 * §4 ("Pruning"). The use case:
 *
 * 1. For each `MemoryEntryKind`, finds active entries with
 *    `confidence < threshold AND use_count == 0 AND createdAt is
 *    older than 30 days` (or the period the implementation chooses;
 *    the threshold is the only configurable knob exposed here).
 * 2. Snapshots each candidate into `pruned` (reason: `low_confidence`).
 * 3. Deletes the row from the live table.
 * 4. Records `EntryPruned` events on the active `CuratorRun`
 *    aggregate.
 *
 * Per `docs/05-memoria-decay.md` §3, `Decision`s and `Entity`s
 * are NOT pruned by this pass — they are only pruned when explicitly
 * marked obsolete. The use case skips those kinds; only `Learning` and
 * `Turn` rows can flow through here.
 *
 * Idempotency:
 * - Calling the use case twice within the same `runId` is safe: the
 *   first call already deleted the rows from the live table, so the
 *   second call's scan finds nothing to prune.
 *
 * Concurrency:
 * - The whole pass MUST run inside a single `DatabaseConnection.transaction(...)`
 *   so a concurrent `mem.recall` does not see a half-pruned state
 *   (the snapshot row exists but the live row is already gone, or
 *   vice versa).
 */
export interface PruneLowConfidence {
  prune(input: {
    runId: CuratorRunId;
    workspaceId: WorkspaceId;
    threshold?: PruneThreshold;
  }): Promise<PruneLowConfidenceResult>;
}
