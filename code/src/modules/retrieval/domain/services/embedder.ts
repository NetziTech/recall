import type { EmbeddingVector } from "../value-objects/embedding-vector.ts";

/**
 * Driven port (interface) for the embedding component.
 *
 * The retrieval domain needs the ability to turn a piece of text into
 * an `EmbeddingVector` so the vector-search adapter can do its job;
 * the choice of model (BGE-Small-EN-1.5, MultilingualE5Base, Voyage,
 * ...) is an infrastructure concern (`docs/06-stack-tecnico.md` §6).
 * The port is intentionally narrow:
 *
 * - `embed(text)` for one-shot needs (the query text at recall time).
 * - `embedBatch(texts)` for the curator's bulk paths (re-embedding
 *   when the model changes; embedding the queue of pending entries).
 *
 * Implementations live in `infrastructure/embedder/` (per the
 * directory structure mandated by
 * `docs/12-lineamientos-arquitectura.md` §2). The `shared/application/
 * ports/embedder.ts` (mentioned in §1.5) is the cross-module version
 * for the workspace and curator modules; this retrieval-flavoured
 * version exists because the spec for this task explicitly asks for
 * the four ports as part of the retrieval domain. The composition
 * root binds both names to the same adapter.
 *
 * Contracts:
 * - The returned vector has the dimension declared by the active
 *   embedder; callers must NOT assume a specific dimension.
 * - On failure, the port emits ONE of two typed errors so callers can
 *   discriminate transport-level outages from per-input rejections
 *   (`EmbedderUnavailableError` vs `EmbedFailedError` in
 *   `domain/errors/`). The `AsyncEmbeddingWorker` relies on this
 *   discrimination to back off the whole batch on transport failures
 *   instead of burning per-item retry budgets — see B-MCP-7
 *   ([issue #24](https://github.com/NetziTech/recall/issues/24)).
 *   Generic recall callers (e.g. the recall use case's vector branch)
 *   may fall back to FTS5 (`docs/01-arquitectura.md` §2.7) on either.
 * - `embedBatch` preserves the input order: the i-th output
 *   corresponds to the i-th input.
 */
export interface Embedder {
  /**
   * Computes the embedding of a single text.
   */
  embed(text: string): Promise<EmbeddingVector>;

  /**
   * Computes the embeddings of a batch of texts. The output array has
   * the same length and order as the input.
   */
  embedBatch(
    texts: readonly string[],
  ): Promise<readonly EmbeddingVector[]>;
}
