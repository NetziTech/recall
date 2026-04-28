import type { Logger } from "../../../../shared/application/ports/logger.port.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type {
  StatsMemory,
  StatsMemoryResult,
} from "../ports/in/stats-memory.port.ts";
import type { MemoryStatsReader } from "../ports/out/memory-stats-reader.port.ts";

/**
 * Use case: compute aggregate counters and time-bounds about the
 * workspace's memory.
 *
 * Implements the `StatsMemory` driving port. Thin wrapper around the
 * `MemoryStatsReader` driven port: the heavy lifting (one
 * `SELECT COUNT(*)` per table plus a `MIN/MAX(created_at_ms)`
 * aggregate) lives in the adapter.
 */
export class StatsMemoryUseCase implements StatsMemory {
  public constructor(
    private readonly reader: MemoryStatsReader,
    private readonly logger: Logger,
  ) {}

  public async stats(input: {
    workspaceId: WorkspaceId;
  }): Promise<StatsMemoryResult> {
    const snapshot = await this.reader.read({
      workspaceId: input.workspaceId,
    });
    this.logger.debug(
      {
        workspaceId: input.workspaceId.toString(),
        decisions: snapshot.counts.decisions,
        learnings: snapshot.counts.learnings,
        entities: snapshot.counts.entities,
        tasks: snapshot.counts.tasks,
        turns: snapshot.counts.turns,
        sessions: snapshot.counts.sessions,
        relations: snapshot.counts.relations,
      },
      "memory stats computed",
    );
    return {
      workspaceId: input.workspaceId,
      counts: snapshot.counts,
      oldestEntryMs: snapshot.oldestEntryMs,
      newestEntryMs: snapshot.newestEntryMs,
    };
  }
}
