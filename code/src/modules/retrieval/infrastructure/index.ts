/**
 * Public surface of `modules/retrieval/infrastructure/`.
 *
 * Re-exports the concrete adapters that the composition root wires
 * into use cases. Mirrors the convention of
 * `modules/secrets/infrastructure/index.ts`.
 */

export { RawEmbedderAdapter } from "./embedder/raw-embedder-adapter.ts";
export {
  TiktokenTokenCounter,
  type TiktokenTokenCounterOptions,
} from "./token-counter/tiktoken-token-counter.ts";
export { SqliteEmbeddingQueueRepository } from "./persistence/sqlite-embedding-queue-repository.ts";
export { SqliteFts5LexicalSearch } from "./persistence/sqlite-fts5-lexical-search.ts";
export { SqliteVecVectorSearch } from "./persistence/sqlite-vec-vector-search.ts";
export { SqliteMemoryProjectionRepository } from "./persistence/sqlite-memory-projection-repository.ts";
export {
  AsyncEmbeddingWorker,
  type AsyncEmbeddingWorkerOptions,
} from "./worker/async-embedding-worker.ts";
export { RetrievalInfrastructureError } from "./errors/retrieval-infrastructure-error.ts";
