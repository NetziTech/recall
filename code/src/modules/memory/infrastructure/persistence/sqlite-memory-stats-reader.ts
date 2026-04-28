import { z } from "zod";

import type { DatabaseConnection } from "../../../../shared/application/ports/database-connection.port.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type {
  MemoryCounts,
  MemoryStatsReader,
  MemoryStatsSnapshot,
} from "../../application/ports/out/memory-stats-reader.port.ts";
import { MemoryInfrastructureError } from "../errors/memory-infrastructure-error.ts";

const CountRowSchema = z.object({ n: z.number().int().min(0) });

const MinMaxRowSchema = z.object({
  oldest: z.number().int().min(0).nullable(),
  newest: z.number().int().min(0).nullable(),
});

const SQL_COUNT_DECISIONS = `SELECT COUNT(*) AS n FROM decisions`;
const SQL_COUNT_ACTIVE_DECISIONS = `
SELECT COUNT(*) AS n FROM decisions WHERE superseded_by IS NULL
`.trim();
const SQL_COUNT_LEARNINGS = `SELECT COUNT(*) AS n FROM learnings`;
const SQL_COUNT_ACTIVE_LEARNINGS = `
SELECT COUNT(*) AS n FROM learnings WHERE consolidated_into IS NULL
`.trim();
const SQL_COUNT_ENTITIES = `SELECT COUNT(*) AS n FROM entities`;
const SQL_COUNT_TASKS = `SELECT COUNT(*) AS n FROM tasks`;
const SQL_COUNT_OPEN_TASKS = `
SELECT COUNT(*) AS n FROM tasks WHERE status != 'done'
`.trim();
const SQL_COUNT_TURNS = `SELECT COUNT(*) AS n FROM turns`;
const SQL_COUNT_SESSIONS = `SELECT COUNT(*) AS n FROM sessions`;
const SQL_COUNT_ACTIVE_SESSIONS = `
SELECT COUNT(*) AS n FROM sessions WHERE ended_at_ms IS NULL
`.trim();
const SQL_COUNT_RELATIONS = `SELECT COUNT(*) AS n FROM relations`;

/**
 * Aggregate the oldest and newest `created_at_ms` (or
 * `recorded_at_ms` for `turns`) across every kind. NULLable on the
 * empty-workspace path.
 */
const SQL_BOUNDS = `
SELECT MIN(created_at_ms) AS oldest, MAX(created_at_ms) AS newest FROM (
  SELECT created_at_ms FROM decisions
  UNION ALL SELECT created_at_ms FROM learnings
  UNION ALL SELECT created_at_ms FROM entities
  UNION ALL SELECT created_at_ms FROM tasks
  UNION ALL SELECT recorded_at_ms FROM turns
  UNION ALL SELECT started_at_ms FROM sessions
  UNION ALL SELECT created_at_ms FROM relations
)
`.trim();

/**
 * SQLite-backed adapter for `MemoryStatsReader`.
 *
 * Issues one `SELECT COUNT(*)` per logical counter and one
 * UNION-ALL aggregate for the time bounds. The total round-trip cost
 * is small (every count uses an index or a B-tree scan); the use case
 * is intended to be invoked from `mem.health` or the CLI's `stats`
 * subcommand and does NOT need to be sub-millisecond.
 *
 * Workspace scoping pinned at construction (per `docs/03-modelo-datos.md`
 * §4.1, the DB IS the workspace).
 */
export class SqliteMemoryStatsReader implements MemoryStatsReader {
  public constructor(
    private readonly db: DatabaseConnection,
    private readonly workspaceId: WorkspaceId,
  ) {}

  public async read(input: {
    workspaceId: WorkspaceId;
  }): Promise<MemoryStatsSnapshot> {
    if (!input.workspaceId.equals(this.workspaceId)) {
      throw MemoryInfrastructureError.queryFailed(
        "memory_stats",
        new Error(
          `workspace mismatch: adapter pinned to ${this.workspaceId.toString()} but caller passed ${input.workspaceId.toString()}`,
        ),
      );
    }

    const counts: MemoryCounts = {
      decisions: this.scalarCount(SQL_COUNT_DECISIONS),
      activeDecisions: this.scalarCount(SQL_COUNT_ACTIVE_DECISIONS),
      learnings: this.scalarCount(SQL_COUNT_LEARNINGS),
      activeLearnings: this.scalarCount(SQL_COUNT_ACTIVE_LEARNINGS),
      entities: this.scalarCount(SQL_COUNT_ENTITIES),
      tasks: this.scalarCount(SQL_COUNT_TASKS),
      openTasks: this.scalarCount(SQL_COUNT_OPEN_TASKS),
      turns: this.scalarCount(SQL_COUNT_TURNS),
      sessions: this.scalarCount(SQL_COUNT_SESSIONS),
      activeSessions: this.scalarCount(SQL_COUNT_ACTIVE_SESSIONS),
      relations: this.scalarCount(SQL_COUNT_RELATIONS),
    };

    const bounds = this.readBounds();
    return Promise.resolve({
      counts,
      oldestEntryMs: bounds.oldest,
      newestEntryMs: bounds.newest,
    });
  }

  // -- internals --------------------------------------------------------

  private scalarCount(sql: string): number {
    const stmt = this.db.prepare(sql);
    let row: unknown;
    try {
      row = stmt.get();
    } catch (cause: unknown) {
      throw MemoryInfrastructureError.queryFailed("memory_stats", cause);
    }
    let parsed: z.infer<typeof CountRowSchema>;
    try {
      parsed = CountRowSchema.parse(row);
    } catch (cause: unknown) {
      throw MemoryInfrastructureError.rowMalformed(
        "memory_stats",
        cause instanceof Error ? cause.message : "count parse failed",
        cause,
      );
    }
    return parsed.n;
  }

  private readBounds(): { oldest: number | null; newest: number | null } {
    const stmt = this.db.prepare(SQL_BOUNDS);
    let row: unknown;
    try {
      row = stmt.get();
    } catch (cause: unknown) {
      throw MemoryInfrastructureError.queryFailed("memory_stats", cause);
    }
    let parsed: z.infer<typeof MinMaxRowSchema>;
    try {
      parsed = MinMaxRowSchema.parse(row);
    } catch (cause: unknown) {
      throw MemoryInfrastructureError.rowMalformed(
        "memory_stats",
        cause instanceof Error ? cause.message : "bounds parse failed",
        cause,
      );
    }
    return { oldest: parsed.oldest, newest: parsed.newest };
  }
}
