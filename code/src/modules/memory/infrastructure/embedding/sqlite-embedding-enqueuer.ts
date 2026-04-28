import type { DatabaseConnection } from "../../../../shared/application/ports/database-connection.port.ts";
import type { IdGenerator } from "../../../../shared/application/ports/id-generator.port.ts";
import type {
  EmbeddableKind,
  EmbeddingEnqueuer,
} from "../../application/ports/out/embedding-enqueuer.port.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import { MemoryInfrastructureError } from "../errors/memory-infrastructure-error.ts";

const SQL_INSERT = `
INSERT INTO embedding_queue (
  id, workspace_id, target_kind, target_row_id, enqueued_at_ms, attempts, last_error
) VALUES (?, ?, ?, ?, ?, 0, NULL)
`.trim();

/**
 * Memory module's adapter for the `EmbeddingEnqueuer` port.
 *
 * Persistence: writes directly into the `embedding_queue` table from
 * `code/migrations/002__retrieval-schema.sql`. The retrieval module's
 * `SqliteEmbeddingQueueRepository.dequeueBatch(...)` consumes the
 * rows; the memory module never reads the queue back.
 *
 * Why direct SQL (vs cross-importing retrieval's
 * `EmbeddingQueueRepository`):
 * - ADR-001 (`docs/12 §1.5.1`) does NOT authorise the
 *   `memory → retrieval` direction. Going through retrieval's port
 *   would require a new ADR entry.
 * - The schema DDL itself is shared infrastructure (per
 *   `docs/01-arquitectura.md` §2.7 — "embedding_queue es la tabla
 *   compartida entre el module memory que escribe y el worker
 *   retrieval que dequeue"). Writing one prepared statement that
 *   matches that DDL is acceptable cross-cutting work; the memory
 *   adapter does not parse the row format on the read side, so the
 *   coupling is one-way.
 * - The narrow port surface (`enqueue` only) keeps the contract
 *   minimal: the memory module only needs to write the job. Any
 *   future change to the schema's columns surfaces as a compile-time
 *   error here AND in the retrieval adapter, so the two stay in
 *   lock-step.
 *
 * Idempotency:
 * - Every call inserts a fresh queue row (the queue has its own
 *   identity column). Re-enqueueing the same `(target_kind,
 *   target_row_id)` produces a duplicate row that the retrieval
 *   worker dedupes at dequeue time.
 */
export class SqliteEmbeddingEnqueuer implements EmbeddingEnqueuer {
  public constructor(
    private readonly db: DatabaseConnection,
    private readonly idGen: IdGenerator,
  ) {}

  public async enqueue(input: {
    workspaceId: WorkspaceId;
    targetKind: EmbeddableKind;
    targetRowId: string;
    enqueuedAt: Timestamp;
  }): Promise<void> {
    const stmt = this.db.prepare(SQL_INSERT);
    try {
      stmt.run(
        this.idGen.generateString(),
        input.workspaceId.toString(),
        input.targetKind,
        input.targetRowId,
        input.enqueuedAt.toEpochMs(),
      );
    } catch (cause: unknown) {
      throw MemoryInfrastructureError.embeddingEnqueueFailed(
        input.targetKind,
        input.targetRowId,
        cause,
      );
    }
    return Promise.resolve();
  }
}
