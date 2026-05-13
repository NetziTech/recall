import type { Timestamp } from "../../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../../shared/domain/value-objects/workspace-id.ts";
import type { EmbeddingVector } from "../../../domain/value-objects/embedding-vector.ts";
import type { QueryKindValue } from "../../../domain/value-objects/query-kind.ts";

/**
 * One row of the `embedding_queue` table documented in
 * `docs/03-modelo-datos.md` §4.10.
 *
 * Carries everything the worker needs to embed a single pending entry
 * — the source `(kind, id)` tuple to look up the searchable text,
 * the number of attempts already made (for exponential-backoff
 * retry), and the most recent error (if any).
 *
 * Modelling choice — `searchableText` is NOT carried inline:
 * - The text the worker embeds is reconstructed from the live row at
 *   dequeue time (the curator may have updated it; embedding the
 *   stale snapshot would defeat the queue's purpose).
 * - The `MemoryProjectionRepository` is the canonical source for the
 *   text reconstruction: the worker calls
 *   `loadProjectionsByHits([{ kind, id }])` and joins the title +
 *   preview per the `searchable_text` rules in `docs/03-modelo-datos.md`
 *   §5.
 *
 * Invariants:
 * - `id` is a UUID v7 distinct from `targetRowId` (the queue row has
 *   its own identity so re-enqueueing the same target produces a new
 *   queue row, not an upsert).
 * - `attempts` is a non-negative integer.
 * - `lastError` is `null` when no attempt failed yet.
 */
export interface EmbeddingQueueItem {
  readonly id: string;
  readonly workspaceId: WorkspaceId;
  readonly targetKind: QueryKindValue;
  readonly targetRowId: string;
  readonly enqueuedAt: Timestamp;
  readonly attempts: number;
  readonly lastError: string | null;
}

/**
 * Driven (output) port: persistence backing the asynchronous
 * embedding queue.
 *
 * The queue exists because `mem.remember` returns sync (< 30 ms)
 * while the embedder is on the critical path of `mem.recall` (the
 * `@huggingface/transformers` model takes 50–200 ms per call after
 * warm-up, plus a one-shot multi-second download on first call —
 * see `docs/06-stack-tecnico.md` §6). The flow:
 *
 * 1. Memory module persists the row + enqueues a job
 *    (`enqueue(...)`).
 * 2. The `AsyncEmbeddingWorker` polls `dequeueBatch(...)`, embeds the
 *    text, persists the vector via the embedder + projection
 *    adapters, and removes the job (`acknowledge(...)`).
 * 3. On transient failure, the worker calls
 *    `recordFailure(...)` to bump `attempts` and store the error;
 *    the next dequeue picks the row up again after the backoff window.
 *
 * Why this port (not the domain `EmbeddingQueue`):
 * - The retrieval domain has no `EmbeddingQueue` concept — embeddings
 *   are an infrastructure-shaped concern (the queue is essentially a
 *   work-list of `(table, row)` pointers waiting on the embedder).
 *   Modelling it as a domain aggregate would not buy any invariant the
 *   schema does not already enforce.
 *
 * Lifecycle:
 * - The composition root wires this port into the `RememberDecisionUseCase`
 *   (memory module, Tarea 3.X) so writes auto-enqueue, and into the
 *   `AsyncEmbeddingWorker` (this module) for processing. Tests use an
 *   in-memory queue.
 */
export interface EmbeddingQueueRepository {
  /**
   * Adds a new pending embedding job. The implementation mints a fresh
   * UUID v7 internally (the queue row's own id is opaque to callers).
   *
   * Idempotency note: enqueueing the same `(kind, id)` twice creates
   * two queue rows. This is intentional — the worker dedupes at
   * dequeue time using a `DISTINCT (target_kind, target_row_id)` SQL
   * predicate so retries do not multiply the embedder load.
   */
  enqueue(input: {
    workspaceId: WorkspaceId;
    targetKind: QueryKindValue;
    targetRowId: string;
    enqueuedAt: Timestamp;
  }): Promise<void>;

  /**
   * Returns up to `limit` items ready for processing, with the oldest
   * first. Items already processed (or under-backoff) are filtered out
   * by the implementation.
   *
   * `availableAfter` is the time before which an item must have last
   * failed to be eligible. The worker passes `now - backoff(attempts)`
   * to skip items still in cool-down.
   */
  dequeueBatch(input: {
    workspaceId: WorkspaceId;
    limit: number;
    availableAfter: Timestamp;
  }): Promise<readonly EmbeddingQueueItem[]>;

  /**
   * Removes a successfully-processed queue row. The vector itself is
   * persisted via the projection repository's vector-write path (see
   * `persistEmbedding`).
   *
   * MUST be a no-op when the queue id is unknown (the worker may have
   * crashed mid-batch and another instance picked the work up).
   */
  acknowledge(queueId: string): Promise<void>;

  /**
   * Bumps `attempts` and stores `errorMessage` on the queue row. Used
   * by the worker to record transient embedder failures.
   *
   * After `MAX_ATTEMPTS` (the worker decides), the row is left in
   * place but no longer dequeued; a separate audit sweep can promote
   * it to a permanent-failure log.
   */
  recordFailure(input: {
    queueId: string;
    errorMessage: string;
  }): Promise<void>;

  /**
   * Persists a freshly-computed embedding vector for a target row.
   *
   * Splits responsibility between this port and
   * `acknowledge(queueId)`: the worker's success path is "persist the
   * vector, then ack the queue row" so a crash between the two leaves
   * the queue row pending (the next dequeue re-runs the embedder,
   * which is wasted work but not data corruption).
   *
   * Implementations:
   * - INSERT into the `embeddings` virtual table (vec0) and the
   *   `embedding_metadata` row.
   * - Mark the underlying `<kind>` row's `embedding_status = 'ready'`
   *   (the `MemoryProjectionRepository` does NOT expose this write —
   *   the column is private to the embedding pipeline).
   */
  persistEmbedding(input: {
    workspaceId: WorkspaceId;
    targetKind: QueryKindValue;
    targetRowId: string;
    embeddedText: string;
    modelName: string;
    vector: EmbeddingVector;
    persistedAt: Timestamp;
  }): Promise<void>;

  /**
   * Returns the count of items currently in the queue, regardless of
   * backoff state. Used by `mem.health` to surface queue depth.
   */
  countPending(workspaceId: WorkspaceId): Promise<number>;

  /**
   * Resets the `attempts` counter (and clears `last_error`) for every
   * queue row whose attempts have reached or exceeded
   * `attemptsAtLeast`. Returns the number of rows updated.
   *
   * Use case: B-MCP-7 recovery
   * ([issue #24](https://github.com/NetziTech/recall/issues/24)). When
   * an embedder cold-start fast-failed before the worker learned to
   * back off (in `<= 0.1.2-beta.3`), a workspace's queue could end up
   * with permanent-failure rows that will NEVER retry. The
   * `recall reset-queue` CLI command calls this method to give those
   * rows another chance once the embedder is healthy again.
   *
   * Implementations:
   * - MUST scope the update to the given `workspaceId` (no
   *   cross-workspace bleed; defence-in-depth on top of the
   *   schema's per-workspace partitioning).
   * - MUST return the row count actually updated (the CLI surfaces
   *   it).
   * - SHOULD be a single `UPDATE ... WHERE workspace_id = ? AND
   *   attempts >= ?` for atomicity (no read-modify-write race).
   */
  resetPermanentFailures(input: {
    workspaceId: WorkspaceId;
    attemptsAtLeast: number;
  }): Promise<number>;
}
