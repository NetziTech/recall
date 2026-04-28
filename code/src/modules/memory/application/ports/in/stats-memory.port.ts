import type { WorkspaceId } from "../../../../../shared/domain/value-objects/workspace-id.ts";

/**
 * Result of a `StatsMemory.stats(...)` invocation.
 *
 * Mirrors the `mem.health.detail` surface in
 * `docs/02-protocolo-mcp.md` §4.6 and the CLI's `mcp-memoria stats`
 * (`docs/07-instalacion.md` §7.8). All numeric counts are non-negative
 * integers; `oldestEntryMs` and `newestEntryMs` are `null` when the
 * workspace is empty.
 */
export interface StatsMemoryResult {
  readonly workspaceId: WorkspaceId;
  readonly counts: Readonly<{
    decisions: number;
    activeDecisions: number;
    learnings: number;
    activeLearnings: number;
    entities: number;
    tasks: number;
    openTasks: number;
    turns: number;
    sessions: number;
    activeSessions: number;
    relations: number;
  }>;
  /** Oldest `created_at_ms` across every kind, or `null`. */
  readonly oldestEntryMs: number | null;
  /** Newest `created_at_ms` across every kind, or `null`. */
  readonly newestEntryMs: number | null;
}

/**
 * Driving (input) port: collect counters and time-bounds about the
 * workspace's memory.
 *
 * The use case is read-only and SHOULD complete in a few SQL round
 * trips (`SELECT COUNT(*) ...` per kind plus a `MIN/MAX(created_at_ms)`
 * aggregate). The CLI wraps it for the `stats` subcommand and the MCP
 * tool registry uses it under `mem.health` (with detail enabled).
 */
export interface StatsMemory {
  stats(input: { workspaceId: WorkspaceId }): Promise<StatsMemoryResult>;
}
