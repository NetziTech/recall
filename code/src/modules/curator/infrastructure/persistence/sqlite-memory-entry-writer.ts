import { z } from "zod";

import type { DatabaseConnection } from "../../../../shared/application/ports/database-connection.port.ts";
import type { Confidence } from "../../../../shared/domain/value-objects/confidence.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { MemoryEntryWriter } from "../../application/ports/out/memory-entry-writer.port.ts";
import type { MemoryEntryKind } from "../../domain/value-objects/memory-entry-kind.ts";
import { CuratorInfrastructureError } from "../errors/curator-infrastructure-error.ts";

/**
 * Stale tag the curator applies to entities whose `location` no
 * longer exists. Mirrors `docs/05-memoria-decay.md` §5 Caso 1
 * ("confidence /= 2, tag 'stale'").
 */
const STALE_TAG = "stale";

const TagsArraySchema = z.array(z.string().min(1));

const SQL_DECAY_DECISION = `UPDATE decisions SET confidence = ? WHERE id = ?`;
const SQL_DECAY_LEARNING = `UPDATE learnings SET confidence = ? WHERE id = ?`;
const SQL_DECAY_ENTITY = `UPDATE entities SET confidence = ? WHERE id = ?`;
const SQL_DECAY_TASK = `UPDATE tasks SET confidence = ? WHERE id = ?`;
const SQL_DECAY_TURN = `UPDATE turns SET confidence = ? WHERE id = ?`;

const SQL_SELECT_ENTITY_FOR_TAG = `
SELECT confidence, tags_json
FROM entities
WHERE id = ?
LIMIT 1
`.trim();

const SQL_TAG_ENTITY_STALE = `
UPDATE entities
SET tags_json = ?, confidence = ?
WHERE id = ?
`.trim();

const SQL_DELETE_DECISION = `DELETE FROM decisions WHERE id = ?`;
const SQL_DELETE_LEARNING = `DELETE FROM learnings WHERE id = ?`;
const SQL_DELETE_ENTITY = `DELETE FROM entities WHERE id = ?`;
const SQL_DELETE_TASK = `DELETE FROM tasks WHERE id = ?`;
const SQL_DELETE_TURN = `DELETE FROM turns WHERE id = ?`;

const SQL_INSERT_PRUNED = `
INSERT INTO pruned (
  workspace_id, kind, original_id, content_snapshot, reason, pruned_at_ms
) VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT (workspace_id, kind, original_id) DO UPDATE SET
  content_snapshot = excluded.content_snapshot,
  reason           = excluded.reason,
  pruned_at_ms     = excluded.pruned_at_ms
`.trim();

/**
 * Adapter that fulfils the `MemoryEntryWriter` driving port using a
 * single SQLite connection.
 *
 * Routing strategy:
 * - The adapter dispatches per-kind via the `MemoryEntryKind`
 *   discriminator. Each kind has its own UPDATE/DELETE statement so
 *   the SQL is straight-line and prepared by the driver's cache.
 *
 * Atomicity:
 * - `markPruned(...)` MUST be atomic at the row level: the audit
 *   snapshot row in `pruned` and the deletion of the live row are
 *   wrapped in a single `DatabaseConnection.transaction(...)` call.
 *   If either statement fails the transaction rolls back; neither
 *   write survives.
 * - `tagEntityAsStale(...)` is a single UPDATE; atomicity is
 *   handled by SQLite.
 * - `applyDecay(...)` is a single UPDATE; atomicity is handled by
 *   SQLite.
 *
 * Cross-import note: the adapter does NOT cross-import `memory/domain`.
 * Every column it touches is named through SQL strings; the
 * `MemoryEntryKind` (curator-owned) is sufficient to dispatch.
 */
export class SqliteMemoryEntryWriter implements MemoryEntryWriter {
  public constructor(private readonly db: DatabaseConnection) {}

  // eslint-disable-next-line @typescript-eslint/require-await -- impl is fully sync; `async` keeps interface throws as rejected promises (test contract).
  public async applyDecay(input: {
    workspaceId: WorkspaceId;
    kind: MemoryEntryKind;
    entryId: string;
    newConfidence: Confidence;
  }): Promise<boolean> {
    const sql = this.decaySqlForKind(input.kind);
    const stmt = this.db.prepare(sql);
    let changes: number;
    try {
      const result = stmt.run(input.newConfidence.toNumber(), input.entryId);
      changes = result.changes;
    } catch (cause: unknown) {
      throw CuratorInfrastructureError.upsertFailed(
        SqliteMemoryEntryWriter.tableForKind(input.kind),
        cause,
      );
    }
    return changes > 0;
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- impl is fully sync; `async` keeps interface throws as rejected promises (test contract).
  public async applyDecayBatch(input: {
    workspaceId: WorkspaceId;
    items: readonly {
      readonly kind: MemoryEntryKind;
      readonly entryId: string;
      readonly newConfidence: Confidence;
    }[];
  }): Promise<number> {
    // workspaceId is validated by the use case before reaching this method.
    if (input.items.length === 0) return 0;

    // Pre-compile one statement per kind to avoid re-resolving the
    // SQL inside the hot loop. `db.prepare` caches at the connection
    // level, but resolving the per-kind SQL string on every iteration
    // still costs ~10% of the batch wall-clock; pinning by kind makes
    // the inner loop a tight `stmt.run(...)`.
    const statementByKind = new Map<string, ReturnType<DatabaseConnection["prepare"]>>();
    const tableByKind = new Map<string, string>();
    for (const item of input.items) {
      const key = item.kind.toString();
      if (statementByKind.has(key)) continue;
      statementByKind.set(key, this.db.prepare(this.decaySqlForKind(item.kind)));
      tableByKind.set(key, SqliteMemoryEntryWriter.tableForKind(item.kind));
    }

    interface FailureCause {
      readonly table: string;
      readonly cause: unknown;
    }
    let totalChanged = 0;
    const failureRef: { current: FailureCause | null } = { current: null };
    try {
      this.db.transaction((): void => {
        for (const item of input.items) {
          const key = item.kind.toString();
          const stmt = statementByKind.get(key);
          /* c8 ignore start -- defensive: every kind from input was registered above; unreachable via public API since prepared statements + tableByKind are populated symmetrically over the same input set. */
          if (stmt === undefined) {
            const err = new Error(`unprepared kind in batch: ${key}`);
            failureRef.current = {
              table: tableByKind.get(key) ?? "<unknown>",
              cause: err,
            };
            throw err;
          }
          /* c8 ignore stop */
          try {
            const result = stmt.run(
              item.newConfidence.toNumber(),
              item.entryId,
            );
            if (result.changes > 0) totalChanged += 1;
          } catch (cause: unknown) {
            failureRef.current = {
              table: tableByKind.get(key) ?? "<unknown>",
              cause,
            };
            throw cause;
          }
        }
      });
    } catch (cause: unknown) {
      const recorded = failureRef.current;
      if (recorded !== null) {
        throw CuratorInfrastructureError.upsertFailed(
          recorded.table,
          recorded.cause,
        );
      }
      throw CuratorInfrastructureError.upsertFailed("<batch>", cause);
    }
    return totalChanged;
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- impl is fully sync; `async` keeps interface throws as rejected promises (test contract).
  public async tagEntityAsStale(input: {
    workspaceId: WorkspaceId;
    entityId: string;
  }): Promise<boolean> {
    // workspaceId is validated by the use case before reaching this method.
    const selectStmt = this.db.prepare(SQL_SELECT_ENTITY_FOR_TAG);
    const row = selectStmt.get(input.entityId);
    if (row === undefined) return false;

    const Schema = z.object({
      confidence: z.number(),
      tags_json: z.string(),
    });
    let parsed: z.infer<typeof Schema>;
    try {
      parsed = Schema.parse(row);
    } catch (cause: unknown) {
      throw CuratorInfrastructureError.rowMalformed(
        "entities",
        cause instanceof Error ? cause.message : "schema parse failed",
        cause,
      );
    }

    let tags: string[];
    try {
      const decoded = JSON.parse(parsed.tags_json) as unknown;
      const validated = TagsArraySchema.parse(decoded);
      tags = [...validated];
    } catch (cause: unknown) {
      throw CuratorInfrastructureError.rowMalformed(
        "entities",
        `tags_json could not be decoded: ${cause instanceof Error ? cause.message : "unknown"}`,
        cause,
      );
    }

    if (tags.includes(STALE_TAG)) return false;
    tags.push(STALE_TAG);

    // Halve confidence per the spec; clamp to non-negative just in
    // case the persisted value drifts above [0, 1] elsewhere.
    const halved = parsed.confidence / 2;
    const newConfidence = halved < 0 ? 0 : halved > 1 ? 0.5 : halved;

    const updateStmt = this.db.prepare(SQL_TAG_ENTITY_STALE);
    let changes: number;
    try {
      const updateResult = updateStmt.run(
        JSON.stringify(tags),
        newConfidence,
        input.entityId,
      );
      changes = updateResult.changes;
    } catch (cause: unknown) {
      throw CuratorInfrastructureError.upsertFailed("entities", cause);
    }
    return changes > 0;
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- impl is fully sync; `async` keeps interface throws as rejected promises (test contract).
  public async markPruned(input: {
    workspaceId: WorkspaceId;
    kind: MemoryEntryKind;
    entryId: string;
    contentSnapshot: string;
    reasonKind:
      | "low_confidence"
      | "manual"
      | "consolidated_into_other"
      | "obsoleted";
    prunedAt: Timestamp;
  }): Promise<boolean> {
    const liveSql = this.deleteSqlForKind(input.kind);

    let wasPruned: boolean;
    try {
      wasPruned = this.db.transaction((): boolean => {
        const insert = this.db.prepare(SQL_INSERT_PRUNED);
        insert.run(
          input.workspaceId.toString(),
          input.kind.toString(),
          input.entryId,
          input.contentSnapshot,
          input.reasonKind,
          input.prunedAt.toEpochMs(),
        );
        const del = this.db.prepare(liveSql);
        const result = del.run(input.entryId);
        return result.changes > 0;
      });
    } catch (cause: unknown) {
      if (cause instanceof CuratorInfrastructureError) throw cause;
      throw CuratorInfrastructureError.upsertFailed(
        SqliteMemoryEntryWriter.tableForKind(input.kind),
        cause,
      );
    }
    return wasPruned;
  }

  // -- internals --------------------------------------------------------

  private decaySqlForKind(kind: MemoryEntryKind): string {
    if (kind.isDecision()) return SQL_DECAY_DECISION;
    if (kind.isLearning()) return SQL_DECAY_LEARNING;
    if (kind.isEntity()) return SQL_DECAY_ENTITY;
    if (kind.isTask()) return SQL_DECAY_TASK;
    if (kind.isTurn()) return SQL_DECAY_TURN;
    throw CuratorInfrastructureError.unsupportedKind(
      "applyDecay",
      kind.toString(),
    );
  }

  private deleteSqlForKind(kind: MemoryEntryKind): string {
    if (kind.isDecision()) return SQL_DELETE_DECISION;
    if (kind.isLearning()) return SQL_DELETE_LEARNING;
    if (kind.isEntity()) return SQL_DELETE_ENTITY;
    if (kind.isTask()) return SQL_DELETE_TASK;
    if (kind.isTurn()) return SQL_DELETE_TURN;
    throw CuratorInfrastructureError.unsupportedKind(
      "markPruned",
      kind.toString(),
    );
  }

  private static tableForKind(kind: MemoryEntryKind): string {
    if (kind.isDecision()) return "decisions";
    if (kind.isLearning()) return "learnings";
    if (kind.isEntity()) return "entities";
    if (kind.isTask()) return "tasks";
    if (kind.isTurn()) return "turns";
    return "<unknown>";
  }
}
