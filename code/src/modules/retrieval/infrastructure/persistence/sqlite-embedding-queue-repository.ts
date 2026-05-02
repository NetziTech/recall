import { z } from "zod";

import type { DatabaseConnection } from "../../../../shared/application/ports/database-connection.port.ts";
import type { IdGenerator } from "../../../../shared/application/ports/id-generator.port.ts";
import { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type {
  EmbeddingQueueItem,
  EmbeddingQueueRepository,
} from "../../application/ports/out/embedding-queue-repository.port.ts";
import type { EmbeddingVector } from "../../domain/value-objects/embedding-vector.ts";
import type { QueryKindValue } from "../../domain/value-objects/query-kind.ts";

/**
 * Zod schema for the persisted shape of an `embedding_queue` row.
 * Validated before any VO factory runs so a tampered SQLite file
 * cannot bypass the domain invariants.
 */
const QueueRowSchema = z.object({
  id: z.string().min(1),
  workspace_id: z.string().min(1),
  target_kind: z.enum(["decision", "learning", "entity", "task", "turn"]),
  target_row_id: z.string().min(1),
  enqueued_at_ms: z.number().int().min(0),
  attempts: z.number().int().min(0),
  last_error: z.string().nullable(),
});

const SQL_INSERT = `
INSERT INTO embedding_queue (
  id, workspace_id, target_kind, target_row_id, enqueued_at_ms, attempts, last_error
) VALUES (?, ?, ?, ?, ?, 0, NULL)
`.trim();

/**
 * Dequeue path. Three predicates compose the filter:
 *
 *   1. Same workspace.
 *   2. Items that never failed (`last_error IS NULL`) are always
 *      eligible.
 *   3. Items that failed are eligible only if `enqueued_at_ms`
 *      is older than `availableAfter` (the worker passes
 *      `now - backoff(attempts)`). The proxy here is approximate —
 *      a precise per-attempt backoff would need a `last_attempt_ms`
 *      column, which the spec does not contemplate.
 *
 * Order: oldest first. Limit is parameterised.
 */
const SQL_DEQUEUE = `
SELECT id, workspace_id, target_kind, target_row_id, enqueued_at_ms, attempts, last_error
FROM embedding_queue
WHERE workspace_id = ?
  AND (last_error IS NULL OR enqueued_at_ms <= ?)
ORDER BY enqueued_at_ms ASC, id ASC
LIMIT ?
`.trim();

const SQL_DELETE = `
DELETE FROM embedding_queue WHERE id = ?
`.trim();

const SQL_RECORD_FAILURE = `
UPDATE embedding_queue
SET attempts = attempts + 1,
    last_error = ?
WHERE id = ?
`.trim();

const SQL_INSERT_VEC = `
INSERT OR REPLACE INTO embeddings (id, vec) VALUES (?, ?)
`.trim();

const SQL_INSERT_VEC_METADATA = `
INSERT INTO embedding_metadata (
  id, workspace_id, target_kind, target_row_id, embedded_text, model_name, dimension, created_at_ms
) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(target_kind, target_row_id, model_name) DO UPDATE SET
  workspace_id  = excluded.workspace_id,
  embedded_text = excluded.embedded_text,
  dimension     = excluded.dimension,
  created_at_ms = excluded.created_at_ms
`.trim();

const SQL_COUNT = `
SELECT COUNT(*) AS n FROM embedding_queue WHERE workspace_id = ?
`.trim();

const CountRowSchema = z.object({ n: z.number().int().min(0) });

/**
 * Reset path for B-MCP-7 recovery
 * ([issue #24](https://github.com/NetziTech/recall/issues/24)). Clears
 * `attempts` and `last_error` for every row in the workspace whose
 * attempts have reached or exceeded the threshold the CLI passes
 * (`MAX_ATTEMPTS = 5` by default). The UPDATE is per-workspace and
 * atomic — no read-modify-write loop.
 */
const SQL_RESET_PERMANENT_FAILURES = `
UPDATE embedding_queue
SET attempts = 0,
    last_error = NULL
WHERE workspace_id = ?
  AND attempts >= ?
`.trim();

/**
 * SQLite adapter for the asynchronous embedding queue and the vec0
 * vector store.
 *
 * Schema dependency: `code/migrations/002__retrieval-schema.sql`
 * (this module's migration). The adapter assumes the migration has
 * already run; the composition root is responsible for ordering.
 *
 * Concurrency:
 * - `dequeueBatch` is read-only. Multiple workers can poll the same
 *   queue safely; the work-stealing path is via `acknowledge(...)`
 *   which is a single DELETE. Two workers picking up the same row
 *   simply have one of them succeed and the other fail silently
 *   (the second DELETE is a no-op).
 * - `persistEmbedding` issues two writes (INSERT into the vec0
 *   virtual table + UPSERT into the metadata table) in a single
 *   transaction so the metadata never lies about the vector.
 *
 * Error handling:
 * - SQL failures bubble up as `DatabaseError` from the underlying
 *   `SqliteDatabase` adapter. The application layer (the worker)
 *   logs them and routes to `recordFailure(...)`.
 *
 * Vector encoding:
 * - sqlite-vec accepts a `Float32Array` directly when bound through a
 *   prepared statement (the better-sqlite3 driver coerces it to a
 *   binary blob). The adapter passes `vector.toFloat32Array()` to
 *   keep ownership semantics clear.
 */
export class SqliteEmbeddingQueueRepository
  implements EmbeddingQueueRepository
{
  public constructor(
    private readonly db: DatabaseConnection,
    private readonly idGenerator: IdGenerator,
  ) {}

  public enqueue(input: {
    workspaceId: WorkspaceId;
    targetKind: QueryKindValue;
    targetRowId: string;
    enqueuedAt: Timestamp;
  }): Promise<void> {
    const stmt = this.db.prepare(SQL_INSERT);
    stmt.run(
      this.idGenerator.generateString(),
      input.workspaceId.toString(),
      input.targetKind,
      input.targetRowId,
      input.enqueuedAt.epochMs,
    );
    return Promise.resolve();
  }

  public dequeueBatch(input: {
    workspaceId: WorkspaceId;
    limit: number;
    availableAfter: Timestamp;
  }): Promise<readonly EmbeddingQueueItem[]> {
    const stmt = this.db.prepare(SQL_DEQUEUE);
    const rows = stmt.all(
      input.workspaceId.toString(),
      input.availableAfter.epochMs,
      input.limit,
    );
    const out: EmbeddingQueueItem[] = [];
    for (const raw of rows) {
      out.push(this.parseRow(raw));
    }
    return Promise.resolve(Object.freeze(out));
  }

  public acknowledge(queueId: string): Promise<void> {
    const stmt = this.db.prepare(SQL_DELETE);
    stmt.run(queueId);
    return Promise.resolve();
  }

  public recordFailure(input: {
    queueId: string;
    errorMessage: string;
  }): Promise<void> {
    const stmt = this.db.prepare(SQL_RECORD_FAILURE);
    stmt.run(input.errorMessage, input.queueId);
    return Promise.resolve();
  }

  public persistEmbedding(input: {
    workspaceId: WorkspaceId;
    targetKind: QueryKindValue;
    targetRowId: string;
    embeddedText: string;
    modelName: string;
    vector: EmbeddingVector;
    persistedAt: Timestamp;
  }): Promise<void> {
    const buffer = input.vector.toFloat32Array();
    const vectorBytes = Buffer.from(
      buffer.buffer,
      buffer.byteOffset,
      buffer.byteLength,
    );

    this.db.transaction((): void => {
      const vecStmt = this.db.prepare(SQL_INSERT_VEC);
      const metaStmt = this.db.prepare(SQL_INSERT_VEC_METADATA);
      // The id of the vec row mirrors the metadata id so a JOIN by
      // id is trivial.
      const id = this.idGenerator.generateString();
      vecStmt.run(id, vectorBytes);
      metaStmt.run(
        id,
        input.workspaceId.toString(),
        input.targetKind,
        input.targetRowId,
        input.embeddedText,
        input.modelName,
        input.vector.dim(),
        input.persistedAt.epochMs,
      );
    });

    return Promise.resolve();
  }

  public countPending(workspaceId: WorkspaceId): Promise<number> {
    const stmt = this.db.prepare(SQL_COUNT);
    const raw = stmt.get(workspaceId.toString());
    if (raw === undefined) return Promise.resolve(0);
    const parsed = CountRowSchema.parse(raw);
    return Promise.resolve(parsed.n);
  }

  public resetPermanentFailures(input: {
    workspaceId: WorkspaceId;
    attemptsAtLeast: number;
  }): Promise<number> {
    const stmt = this.db.prepare(SQL_RESET_PERMANENT_FAILURES);
    const result = stmt.run(
      input.workspaceId.toString(),
      input.attemptsAtLeast,
    );
    // The SqliteDatabase wrapper returns `changes` from better-sqlite3
    // as a number; defensive parse via Zod keeps the contract honest
    // for stub repositories (in-memory implementations may report it
    // differently).
    const changes = z.number().int().min(0).parse(result.changes);
    return Promise.resolve(changes);
  }

  // -- internals --------------------------------------------------------

  private parseRow(raw: unknown): EmbeddingQueueItem {
    const parsed = QueueRowSchema.parse(raw);
    return {
      id: parsed.id,
      workspaceId: WorkspaceId.from(parsed.workspace_id),
      targetKind: parsed.target_kind,
      targetRowId: parsed.target_row_id,
      enqueuedAt: Timestamp.fromEpochMs(parsed.enqueued_at_ms),
      attempts: parsed.attempts,
      lastError: parsed.last_error,
    };
  }
}
