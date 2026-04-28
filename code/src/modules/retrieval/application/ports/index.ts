/**
 * Public surface of `modules/retrieval/application/ports/`.
 *
 * Mirrors the convention of `modules/secrets/application/ports/` —
 * driving (input) ports under `in/`, driven (output) ports under
 * `out/`. The split keeps the dependency arrows visible at the
 * import path level (Clean Architecture §1.3).
 *
 * Driven (output) ports already in `domain/services/` (the source of
 * truth for `Embedder`, `LexicalSearch`, `VectorSearch`,
 * `TokenCounter`) are NOT re-exported here: their natural home is
 * the domain because the hybrid scorer and bundle aggregator consume
 * them directly. Only ports that are exclusively application-layer
 * concerns live under `application/ports/out/`:
 *
 * - `MemoryProjectionRepository` — read-only access to the memory
 *   bounded context for hydration of `*Ref` projections and structural
 *   layer reads.
 * - `EmbeddingQueueRepository` — persistence backing the asynchronous
 *   `embedding_queue` documented in `docs/03-modelo-datos.md` §4.10.
 */

export type { RecallMemory } from "./in/recall-memory.port.ts";
export type {
  GetContextBundle,
  LayerBudgetOverrides,
} from "./in/get-context-bundle.port.ts";
export type { CountTokens } from "./in/count-tokens.port.ts";

export type {
  MemoryProjection,
  MemoryProjectionRepository,
} from "./out/memory-projection-repository.port.ts";
export type {
  EmbeddingQueueItem,
  EmbeddingQueueRepository,
} from "./out/embedding-queue-repository.port.ts";
