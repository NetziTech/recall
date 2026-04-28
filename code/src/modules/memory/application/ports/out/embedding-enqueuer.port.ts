import type { Timestamp } from "../../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../../shared/domain/value-objects/workspace-id.ts";

/**
 * Set of memory kinds whose `searchable_text` is embedded asynchronously
 * by the retrieval module's worker. Mirrors `embedding_queue.target_kind`
 * from `code/migrations/002__retrieval-schema.sql` and the literal set
 * documented in `docs/03-modelo-datos.md` §4.10.
 *
 * `task` is NOT in the set: per `docs/04-capas-contexto.md` §3.3 tasks
 * are queried by lifecycle slot (`status, priority`), not by free-text
 * search. The memory adapter therefore never enqueues an embedding job
 * for a `Task`.
 */
export type EmbeddableKind = "decision" | "learning" | "entity" | "turn";

/**
 * Driven (output) port: hand a freshly-persisted memory row to the
 * embedding pipeline.
 *
 * Why a memory-local port instead of importing
 * `EmbeddingQueueRepository` from `retrieval/`:
 * - ADR-001 (`docs/12 §1.5.1`) authorises ONE direction:
 *   `retrieval/curator → memory/domain`. The reverse direction
 *   (`memory → retrieval`) is NOT authorised. A memory-local port
 *   keeps the dependency graph compliant: the memory module talks to
 *   an interface it owns; the composition root wires that interface
 *   to retrieval's `EmbeddingQueueRepository.enqueue(...)` adapter.
 * - SOLID-ISP: the memory module only needs the *write-the-job*
 *   slice of the queue. The full
 *   `EmbeddingQueueRepository` carries dequeue, ack, persist, count,
 *   ... — none of which the memory module ever calls. A narrow port
 *   minimises the test surface (a fake here is one method, not five).
 *
 * Contract:
 * - The enqueue is a fire-and-forget write: the implementation
 *   returns once the queue row is durable. The use case calling
 *   `enqueue(...)` does NOT wait for the embedder to actually
 *   produce the vector.
 * - Failures MUST surface as
 *   `MemoryInfrastructureError.embeddingEnqueueFailed(...)`.
 * - The enqueue is fire-and-forget at the *use case* level too: a
 *   failure here is logged but does NOT roll back the row write.
 *   Embeddings are regenerable from the source row (`docs/03-modelo-datos.md`
 *   §5 — "El vector store es REGENERABLE"); the curator can re-run
 *   the queue population on demand.
 */
export interface EmbeddingEnqueuer {
  enqueue(input: {
    workspaceId: WorkspaceId;
    targetKind: EmbeddableKind;
    targetRowId: string;
    enqueuedAt: Timestamp;
  }): Promise<void>;
}
