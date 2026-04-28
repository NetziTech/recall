/**
 * Wires the `retrieval` module: lexical / vector search adapters,
 * the projection repository, the embedding queue, the token counter,
 * and the use cases (`GetContextBundle`, `RecallMemory`, `CountTokens`,
 * `EmbedAndPersist`).
 *
 * The adapters all receive the shared `DatabaseConnection` which the
 * composition root opens once per workspace. The retrieval module
 * does NOT own the database; it only consumes the connection.
 */

import type { DatabaseConnection } from "../../shared/application/ports/database-connection.port.ts";
import type { Clock } from "../../shared/application/ports/clock.port.ts";
import type { IdGenerator } from "../../shared/application/ports/id-generator.port.ts";
import type { Logger } from "../../shared/application/ports/logger.port.ts";
import { CountTokensUseCase } from "../../modules/retrieval/application/use-cases/count-tokens.use-case.ts";
import { EmbedAndPersistUseCase } from "../../modules/retrieval/application/use-cases/embed-and-persist.use-case.ts";
import { GetContextBundleUseCase } from "../../modules/retrieval/application/use-cases/get-context-bundle.use-case.ts";
import { RecallMemoryUseCase } from "../../modules/retrieval/application/use-cases/recall-memory.use-case.ts";
import type { Embedder as RetrievalEmbedder } from "../../modules/retrieval/domain/services/embedder.ts";
import {
  SqliteEmbeddingQueueRepository,
  SqliteFts5LexicalSearch,
  SqliteMemoryProjectionRepository,
  SqliteVecVectorSearch,
  TiktokenTokenCounter,
} from "../../modules/retrieval/infrastructure/index.ts";

/**
 * Bag of retrieval-module use cases the rest of composition consumes
 * either directly (the embedding worker drains
 * `EmbedAndPersistUseCase`) or via mcp-server facades (`mem.context`
 * → `GetContextBundleUseCase`, `mem.recall` → `RecallMemoryUseCase`).
 */
export interface RetrievalWiring {
  readonly getContextBundle: GetContextBundleUseCase;
  readonly recallMemory: RecallMemoryUseCase;
  readonly countTokens: CountTokensUseCase;
  readonly embedAndPersist: EmbedAndPersistUseCase;
  readonly projections: SqliteMemoryProjectionRepository;
  readonly embeddingQueue: SqliteEmbeddingQueueRepository;
  readonly tokenCounter: TiktokenTokenCounter;
}

export interface RetrievalWiringOptions {
  readonly logger: Logger;
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
  readonly database: DatabaseConnection;
  readonly embedder: RetrievalEmbedder;
}

/**
 * Builds the retrieval wiring. The token counter uses the default
 * `cl100k_base` encoding (compatible with most OpenAI models and the
 * heuristic embedder cap documented in `docs/06 §6`).
 */
export function buildRetrievalWiring(
  options: RetrievalWiringOptions,
): RetrievalWiring {
  const projections = new SqliteMemoryProjectionRepository(options.database);
  const embeddingQueue = new SqliteEmbeddingQueueRepository(
    options.database,
    options.idGenerator,
  );
  const lexical = new SqliteFts5LexicalSearch(options.database);
  const vector = new SqliteVecVectorSearch(options.database);
  const tokenCounter = new TiktokenTokenCounter();

  const getContextBundle = new GetContextBundleUseCase(
    options.embedder,
    lexical,
    vector,
    projections,
    tokenCounter,
    options.clock,
    options.idGenerator,
    options.logger,
  );

  const recallMemory = new RecallMemoryUseCase(
    options.embedder,
    lexical,
    vector,
    projections,
    tokenCounter,
    options.clock,
    options.logger,
  );

  const countTokens = new CountTokensUseCase(tokenCounter);

  const embedAndPersist = new EmbedAndPersistUseCase(
    embeddingQueue,
    projections,
    options.embedder,
    options.clock,
    options.logger,
  );

  return {
    getContextBundle,
    recallMemory,
    countTokens,
    embedAndPersist,
    projections,
    embeddingQueue,
    tokenCounter,
  };
}
