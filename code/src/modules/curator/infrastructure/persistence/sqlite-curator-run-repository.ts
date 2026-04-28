import { z } from "zod";

import type { DatabaseConnection } from "../../../../shared/application/ports/database-connection.port.ts";
import { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import { CuratorRun } from "../../domain/aggregates/curator-run.ts";
import type { CuratorRunRepository } from "../../domain/repositories/curator-run-repository.ts";
import { CuratorRunId } from "../../domain/value-objects/curator-run-id.ts";
import { CuratorRunStats } from "../../domain/value-objects/curator-run-stats.ts";
import { CuratorRunTrigger } from "../../domain/value-objects/curator-run-trigger.ts";
import { CuratorInfrastructureError } from "../errors/curator-infrastructure-error.ts";

/**
 * Zod schema for a `curator_runs` row. The schema validates EVERY
 * field before any VO factory runs so a tampered SQLite file cannot
 * bypass the domain invariants. Mirrors the column layout in
 * `code/migrations/003__pruned-and-curator-runs.sql`.
 */
const CuratorRunRowSchema = z.object({
  id: z.string().min(1),
  workspace_id: z.string().min(1),
  trigger: z.string().min(1),
  started_at_ms: z.number().int().min(0),
  ended_at_ms: z.number().int().min(0).nullable(),
  entries_scanned: z.number().int().min(0),
  entries_decayed: z.number().int().min(0),
  entries_pruned: z.number().int().min(0),
  learnings_consolidated: z.number().int().min(0),
  paths_corrected: z.number().int().min(0),
  embeddings_requeued: z.number().int().min(0),
  open_questions_aged: z.number().int().min(0),
  duration_ms: z.number().int().min(0),
});

const SQL_UPSERT = `
INSERT INTO curator_runs (
  id, workspace_id, trigger, started_at_ms, ended_at_ms,
  entries_scanned, entries_decayed, entries_pruned, learnings_consolidated,
  paths_corrected, embeddings_requeued, open_questions_aged, duration_ms
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  workspace_id           = excluded.workspace_id,
  trigger                = excluded.trigger,
  started_at_ms          = excluded.started_at_ms,
  ended_at_ms            = excluded.ended_at_ms,
  entries_scanned        = excluded.entries_scanned,
  entries_decayed        = excluded.entries_decayed,
  entries_pruned         = excluded.entries_pruned,
  learnings_consolidated = excluded.learnings_consolidated,
  paths_corrected        = excluded.paths_corrected,
  embeddings_requeued    = excluded.embeddings_requeued,
  open_questions_aged    = excluded.open_questions_aged,
  duration_ms            = excluded.duration_ms
`.trim();

const SQL_SELECT_BY_ID = `
SELECT id, workspace_id, trigger, started_at_ms, ended_at_ms,
       entries_scanned, entries_decayed, entries_pruned, learnings_consolidated,
       paths_corrected, embeddings_requeued, open_questions_aged, duration_ms
FROM curator_runs
WHERE id = ?
LIMIT 1
`.trim();

const SQL_SELECT_RECENT_BY_WORKSPACE = `
SELECT id, workspace_id, trigger, started_at_ms, ended_at_ms,
       entries_scanned, entries_decayed, entries_pruned, learnings_consolidated,
       paths_corrected, embeddings_requeued, open_questions_aged, duration_ms
FROM curator_runs
WHERE workspace_id = ?
ORDER BY started_at_ms DESC, id DESC
LIMIT ?
`.trim();

const SQL_SELECT_LAST_BY_WORKSPACE = `
SELECT id, workspace_id, trigger, started_at_ms, ended_at_ms,
       entries_scanned, entries_decayed, entries_pruned, learnings_consolidated,
       paths_corrected, embeddings_requeued, open_questions_aged, duration_ms
FROM curator_runs
WHERE workspace_id = ?
ORDER BY started_at_ms DESC, id DESC
LIMIT 1
`.trim();

/**
 * Adapter that fulfils the `CuratorRunRepository` domain port using
 * the SQLite `curator_runs` table.
 *
 * Persistence shape:
 * - One row per `CuratorRun`. The `findings` and `consolidations`
 *   collections accumulated on the aggregate are NOT persisted by
 *   this adapter — they are observable only via the buffered domain
 *   events that the application layer drains after `save(...)`. The
 *   table layout in
 *   `code/migrations/003__pruned-and-curator-runs.sql` therefore has
 *   no per-finding / per-consolidation columns; the audit trail
 *   lives in the structured logger plus the `pruned` table.
 *
 * Invariants:
 * - `save(...)` is upsert by id (idempotent re-save).
 * - The query methods MUST NOT throw on "no row found"; they return
 *   `null` / empty array instead.
 *
 * Concurrency:
 * - Every method uses prepared statements; the SQL binding is the
 *   only way data crosses the SQL boundary (no string interpolation).
 */
export class SqliteCuratorRunRepository implements CuratorRunRepository {
  public constructor(private readonly db: DatabaseConnection) {}

  public async findById(id: CuratorRunId): Promise<CuratorRun | null> {
    const stmt = this.db.prepare(SQL_SELECT_BY_ID);
    const row = stmt.get(id.toString());
    if (row === undefined) return Promise.resolve(null);
    return Promise.resolve(this.parseRow(row));
  }

  public async save(run: CuratorRun): Promise<void> {
    const stats = run.getStats();
    const counters = stats.toRecord();
    const stmt = this.db.prepare(SQL_UPSERT);
    try {
      stmt.run(
        run.getId().toString(),
        run.getWorkspaceId().toString(),
        run.getTrigger().toString(),
        run.getStartedAt().toEpochMs(),
        run.getEndedAt()?.toEpochMs() ?? null,
        counters.entriesScanned,
        counters.entriesDecayed,
        counters.entriesPruned,
        counters.learningsConsolidated,
        counters.pathsCorrected,
        counters.embeddingsRequeued,
        counters.openQuestionsAged,
        counters.durationMs,
      );
    } catch (cause: unknown) {
      throw CuratorInfrastructureError.upsertFailed("curator_runs", cause);
    }
    return Promise.resolve();
  }

  public async findRecentByWorkspace(
    workspaceId: WorkspaceId,
    limit: number,
  ): Promise<readonly CuratorRun[]> {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw CuratorInfrastructureError.rowMalformed(
        "curator_runs",
        `limit must be a positive integer (got: ${String(limit)})`,
      );
    }
    const stmt = this.db.prepare(SQL_SELECT_RECENT_BY_WORKSPACE);
    const rows = stmt.all(workspaceId.toString(), limit);
    const out: CuratorRun[] = [];
    for (const row of rows) {
      out.push(this.parseRow(row));
    }
    return Promise.resolve(Object.freeze(out));
  }

  public async findLastByWorkspace(
    workspaceId: WorkspaceId,
  ): Promise<CuratorRun | null> {
    const stmt = this.db.prepare(SQL_SELECT_LAST_BY_WORKSPACE);
    const row = stmt.get(workspaceId.toString());
    if (row === undefined) return Promise.resolve(null);
    return Promise.resolve(this.parseRow(row));
  }

  // -- internals --------------------------------------------------------

  private parseRow(raw: unknown): CuratorRun {
    let parsed: z.infer<typeof CuratorRunRowSchema>;
    try {
      parsed = CuratorRunRowSchema.parse(raw);
    } catch (cause: unknown) {
      throw CuratorInfrastructureError.rowMalformed(
        "curator_runs",
        cause instanceof Error ? cause.message : "schema parse failed",
        cause,
      );
    }
    const stats = CuratorRunStats.of({
      entriesScanned: parsed.entries_scanned,
      entriesDecayed: parsed.entries_decayed,
      entriesPruned: parsed.entries_pruned,
      learningsConsolidated: parsed.learnings_consolidated,
      pathsCorrected: parsed.paths_corrected,
      embeddingsRequeued: parsed.embeddings_requeued,
      openQuestionsAged: parsed.open_questions_aged,
      durationMs: parsed.duration_ms,
    });
    return CuratorRun.rehydrate({
      id: CuratorRunId.from(parsed.id),
      workspaceId: WorkspaceId.from(parsed.workspace_id),
      trigger: CuratorRunTrigger.create(parsed.trigger),
      startedAt: Timestamp.fromEpochMs(parsed.started_at_ms),
      endedAt:
        parsed.ended_at_ms === null
          ? null
          : Timestamp.fromEpochMs(parsed.ended_at_ms),
      stats,
      // The `findings` and `consolidations` collections are NOT
      // persisted by this adapter (see class JSDoc). On rehydrate we
      // pass empty arrays; subscribers consumed the events at the time
      // the run was originally recorded.
      findings: [],
      consolidations: [],
    });
  }
}
