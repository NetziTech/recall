import { z } from "zod";

import type { DatabaseConnection } from "../../../../shared/application/ports/database-connection.port.ts";
import { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { PrunedEntryRepository } from "../../domain/repositories/pruned-entry-repository.ts";
import { MemoryEntryKind } from "../../domain/value-objects/memory-entry-kind.ts";
import { PrunedEntry } from "../../domain/value-objects/pruned-entry.ts";
import { PrunedReason } from "../../domain/value-objects/pruned-reason.ts";
import { CuratorInfrastructureError } from "../errors/curator-infrastructure-error.ts";

/**
 * Zod schema for a `pruned` row. Mirrors the column layout in
 * `code/migrations/003__pruned-and-curator-runs.sql`. The composite
 * primary key is `(workspace_id, kind, original_id)`.
 */
const PrunedRowSchema = z.object({
  workspace_id: z.string().min(1),
  kind: z.string().min(1),
  original_id: z.string().min(1),
  content_snapshot: z.string().min(1),
  reason: z.string().min(1),
  pruned_at_ms: z.number().int().min(0),
});

const SQL_INSERT = `
INSERT INTO pruned (
  workspace_id, kind, original_id, content_snapshot, reason, pruned_at_ms
) VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT (workspace_id, kind, original_id) DO UPDATE SET
  content_snapshot = excluded.content_snapshot,
  reason           = excluded.reason,
  pruned_at_ms     = excluded.pruned_at_ms
`.trim();

const SQL_SELECT_BY_KEY = `
SELECT workspace_id, kind, original_id, content_snapshot, reason, pruned_at_ms
FROM pruned
WHERE workspace_id = ? AND kind = ? AND original_id = ?
LIMIT 1
`.trim();

const SQL_SELECT_BY_WORKSPACE = `
SELECT workspace_id, kind, original_id, content_snapshot, reason, pruned_at_ms
FROM pruned
WHERE workspace_id = ?
ORDER BY pruned_at_ms DESC, original_id DESC
LIMIT ?
`.trim();

/**
 * Adapter that fulfils the `PrunedEntryRepository` domain port using
 * the SQLite `pruned` table.
 *
 * Persistence shape:
 * - One row per `PrunedEntry`. The composite PK
 *   `(workspace_id, kind, original_id)` matches the audit-trail
 *   semantics: at most one snapshot per (kind, id) per workspace.
 * - `save(...)` is upsert (idempotent). Per the table contract in
 *   `docs/03-modelo-datos.md` §4.9 the audit trail is append-only
 *   from a business perspective; the upsert exists so a curator
 *   replay (e.g. recovery from a crashed pass) does not raise on
 *   the duplicate insert.
 *
 * Invariants:
 * - The query methods MUST NOT throw on "no row found"; they return
 *   `null` / empty array instead.
 */
export class SqlitePrunedEntryRepository implements PrunedEntryRepository {
  public constructor(private readonly db: DatabaseConnection) {}

  public async save(entry: PrunedEntry): Promise<void> {
    const stmt = this.db.prepare(SQL_INSERT);
    try {
      stmt.run(
        entry.workspaceId.toString(),
        entry.getKind().toString(),
        entry.getOriginalId(),
        entry.contentSnapshot,
        entry.reason.toString(),
        entry.prunedAt.toEpochMs(),
      );
    } catch (cause: unknown) {
      throw CuratorInfrastructureError.upsertFailed("pruned", cause);
    }
    return Promise.resolve();
  }

  public async findById(
    workspaceId: WorkspaceId,
    kind: MemoryEntryKind,
    originalId: string,
  ): Promise<PrunedEntry | null> {
    const stmt = this.db.prepare(SQL_SELECT_BY_KEY);
    const row = stmt.get(
      workspaceId.toString(),
      kind.toString(),
      originalId,
    );
    if (row === undefined) return Promise.resolve(null);
    return Promise.resolve(this.parseRow(row));
  }

  public async findByWorkspace(
    workspaceId: WorkspaceId,
    limit: number,
  ): Promise<readonly PrunedEntry[]> {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw CuratorInfrastructureError.rowMalformed(
        "pruned",
        `limit must be a positive integer (got: ${String(limit)})`,
      );
    }
    const stmt = this.db.prepare(SQL_SELECT_BY_WORKSPACE);
    const rows = stmt.all(workspaceId.toString(), limit);
    const out: PrunedEntry[] = [];
    for (const row of rows) {
      out.push(this.parseRow(row));
    }
    return Promise.resolve(Object.freeze(out));
  }

  // -- internals --------------------------------------------------------

  private parseRow(raw: unknown): PrunedEntry {
    let parsed: z.infer<typeof PrunedRowSchema>;
    try {
      parsed = PrunedRowSchema.parse(raw);
    } catch (cause: unknown) {
      throw CuratorInfrastructureError.rowMalformed(
        "pruned",
        cause instanceof Error ? cause.message : "schema parse failed",
        cause,
      );
    }
    return PrunedEntry.create({
      workspaceId: WorkspaceId.from(parsed.workspace_id),
      kind: MemoryEntryKind.create(parsed.kind),
      originalId: parsed.original_id,
      contentSnapshot: parsed.content_snapshot,
      reason: PrunedReason.create(parsed.reason),
      prunedAt: Timestamp.fromEpochMs(parsed.pruned_at_ms),
    });
  }
}
