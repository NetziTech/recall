/**
 * Public surface of `modules/retrieval/application/use-cases/`.
 *
 * Re-exports every use-case class so the composition root and the
 * tests pick them up through one stable barrel.
 */

export { CountTokensUseCase } from "./count-tokens.use-case.ts";
export { GetContextBundleUseCase } from "./get-context-bundle.use-case.ts";
export { RecallMemoryUseCase } from "./recall-memory.use-case.ts";
export { EmbedAndPersistUseCase } from "./embed-and-persist.use-case.ts";
export {
  DEFAULT_RESET_THRESHOLD,
  ResetEmbeddingQueueUseCase,
  type ResetEmbeddingQueueResult,
} from "./reset-embedding-queue.use-case.ts";
