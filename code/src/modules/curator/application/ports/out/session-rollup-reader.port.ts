import type { Confidence } from "../../../../../shared/domain/value-objects/confidence.ts";
import type { Timestamp } from "../../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../../shared/domain/value-objects/workspace-id.ts";

/**
 * Read-only projection of a turn used by the session-rollup pass to
 * generate a session summary.
 *
 * The rollup picks the top-N turns by confidence and concatenates
 * their `summary` fields with light formatting; the projection is
 * therefore a flat (id, summary, confidence, recordedAt) tuple
 * rather than the full `Turn` aggregate. Loading aggregates would
 * triple the I/O cost for no reason — the rollup never mutates the
 * turns themselves.
 */
export interface TurnRollupProjection {
  readonly turnId: string;
  readonly summary: string;
  readonly confidence: Confidence;
  readonly recordedAt: Timestamp;
}

/**
 * Driven (output) port for the session-rollup pass.
 *
 * The adapter (`SqliteSessionRollupReader` in
 * `modules/curator/infrastructure/persistence/`) supplies the turns
 * the rollup needs WITHOUT loading the full `Turn` aggregates from
 * `memory/domain`. The adapter cross-imports `memory/domain` to
 * reconstruct VOs (authorised by ADR-001) but the curator's
 * application layer only sees the flat projection.
 *
 * Why this is separate from `MemoryEntryReader`:
 * - The rollup needs turns scoped to a specific `sessionId`, ordered
 *   by `confidence DESC, recordedAt ASC`. Adding that to the
 *   `MemoryEntryReader` interface would either force every other
 *   call site to deal with the session filter (breaking ISP) or
 *   bloat the interface with an optional argument.
 * - The summary-generation path may grow extra fields later
 *   (`intent`, `outcome`, `tags`); keeping the projection narrow
 *   here avoids feature-creeping the broader reader.
 */
export interface SessionRollupReader {
  /**
   * Returns up to `limit` turns of `sessionId`, ordered by
   * confidence (descending). Used by the session-rollup pass to
   * pick the top-N turns whose summaries it concatenates.
   *
   * Returns an empty array when the session has no recorded turns.
   * The adapter MUST honour `limit > 0`; passing zero raises an
   * `InvalidInputError` (the curator domain's standard validation).
   */
  listTopTurns(input: {
    workspaceId: WorkspaceId;
    sessionId: string;
    limit: number;
  }): Promise<readonly TurnRollupProjection[]>;
}
