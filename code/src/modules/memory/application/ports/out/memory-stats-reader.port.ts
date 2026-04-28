import type { WorkspaceId } from "../../../../../shared/domain/value-objects/workspace-id.ts";

/**
 * Per-kind counters returned by `MemoryStatsReader.read(...)`.
 *
 * The shape mirrors `StatsMemoryResult.counts`; the use case copies
 * the bag verbatim into its result.
 */
export interface MemoryCounts {
  readonly decisions: number;
  readonly activeDecisions: number;
  readonly learnings: number;
  readonly activeLearnings: number;
  readonly entities: number;
  readonly tasks: number;
  readonly openTasks: number;
  readonly turns: number;
  readonly sessions: number;
  readonly activeSessions: number;
  readonly relations: number;
}

/**
 * Result of a `MemoryStatsReader.read(...)` call.
 */
export interface MemoryStatsSnapshot {
  readonly counts: MemoryCounts;
  readonly oldestEntryMs: number | null;
  readonly newestEntryMs: number | null;
}

/**
 * Driven (output) port: collect aggregate counters and time-bounds
 * about the workspace's memory.
 *
 * Why a dedicated port instead of doing the work in the use case via
 * the existing repositories:
 * - The repositories speak in aggregates (`Decision`, `Learning`,
 *   ...). Materialising every aggregate just to count them would be
 *   wasted work — the implementation issues a `SELECT COUNT(*)` per
 *   table and returns the bag.
 * - Keeping the count-shaped query off the aggregate repositories
 *   preserves their "hydrates aggregates" contract; mixing in a
 *   bag-of-numbers method would violate ISP.
 *
 * Implementations live in `infrastructure/persistence/`.
 */
export interface MemoryStatsReader {
  read(input: { workspaceId: WorkspaceId }): Promise<MemoryStatsSnapshot>;
}
