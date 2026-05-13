/**
 * Driven (output) port for the embedding component, in its
 * cross-module / transversal flavour.
 *
 * Why this lives in `shared/application/ports/`:
 * - `docs/12-lineamientos-arquitectura.md` §1.5 mandates a shared
 *   `embedder.ts` port. The retrieval module reads it at recall time
 *   to embed the query; the curator module reads it during the
 *   embedding-queue drain (`docs/05-memoria-decay.md` §5) to embed
 *   freshly-recorded entries. Workspace also touches it at init when
 *   the embedder spec is selected (`docs/07-instalacion.md` §5).
 *
 * The dimension neutralisation problem
 * ------------------------------------
 *
 * The retrieval module owns the `EmbeddingVector` value object
 * (`modules/retrieval/domain/value-objects/embedding-vector.ts`). A
 * shared port CANNOT import that VO without re-introducing a
 * cross-module dependency from `shared/` into `retrieval/`, which is
 * forbidden by `docs/12 §1.5` Regla 2 and is NOT one of the
 * exceptions authorised by ADR-001 (§1.5.1). The reverse direction
 * (`retrieval/` already depends on `shared/`) is fine, but `shared/`
 * pulling from `retrieval/` would invert the dependency tree.
 *
 * Decision: this port speaks raw `Float32Array` plus an explicit
 * `dimension` field. The retrieval module already exposes a *second*
 * port (`retrieval/domain/services/embedder.ts`) that returns the
 * `EmbeddingVector` VO; that port is the one retrieval use cases
 * consume. The composition root binds both names to the same
 * adapter — see `docs/12-lineamientos-arquitectura.md` §2 example
 * "The composition root binds both names to the same adapter".
 *
 * Why `Float32Array` and not `readonly number[]`:
 * - `@huggingface/transformers` and `sqlite-vec` both work in `Float32`
 *   precision (`docs/06-stack-tecnico.md` §6, §7); `number[]` would
 *   force a per-call copy and silently lose precision on quantised
 *   embedders.
 * - `Float32Array` carries its dimension on the buffer (`length`),
 *   which makes the consumer's shape-check trivial.
 *
 * Mutation contract:
 * - The adapter MUST return a buffer that the caller owns: the
 *   adapter MUST NOT retain a reference to it, and the caller is
 *   free to copy or hand it to the `EmbeddingVector` factory (which
 *   makes its own defensive copy). Callers MUST NOT mutate the
 *   returned buffer after passing it to a downstream consumer; if
 *   ownership transfers, treat it as transferred.
 *
 * Implementation expectations:
 * - `shared/infrastructure/embedder/transformers-embedder.ts` is the
 *   default backend (`docs/06-stack-tecnico.md` §6), wrapping
 *   `@huggingface/transformers` with a model-cache resolver pointed at
 *   `~/.cache/recall/models/`. The legacy `fastembed-adapter.ts` was
 *   removed in `v0.1.3` because its transitive `tar@^6` carried 6
 *   high-severity advisories.
 * - `shared/infrastructure/embedder/voyage-adapter.ts` is the
 *   opt-in cloud backend (`docs/06-stack-tecnico.md` §6 footnote),
 *   gated by `embedder.spec` in `config.json`.
 * - Adapters expose the same `dimension()` value at construction so
 *   the workspace can persist it in `config.json` and reject a re-init
 *   that would change dimensions silently.
 *
 * Test doubles (live in `tests/fixtures/`):
 * - `DeterministicFakeEmbedder(dimension)` returns a hash-based vector
 *   so the same string maps to the same vector; useful for
 *   integration tests of recall over a seeded corpus.
 * - `FailingEmbedder(error)` throws on every call; used to verify the
 *   FTS5 fallback path documented in `docs/01-arquitectura.md` §2.7.
 *
 * Lifecycle / errors:
 * - The implementation is allowed to throw on transient failures
 *   (model not loaded, network down for cloud adapters); the caller
 *   handles the error by falling back to FTS5-only recall and
 *   surfaces a `fallback_reason` on the `RecallResult`
 *   (`docs/01-arquitectura.md` §2.7).
 */

/**
 * One row of an embedder output: the vector itself plus the
 * dimension it was produced with.
 *
 * Why a wrapper instead of a bare `Float32Array`:
 * - The receiver of this port (e.g. the retrieval `Embedder` adapter
 *   that builds an `EmbeddingVector` VO) needs to validate the
 *   dimension matches the workspace's pinned dimension. Carrying
 *   the dimension explicitly removes any ambiguity about whether
 *   the buffer length is the true dimension or some padded /
 *   truncated representation.
 * - It also keeps the contract symmetric with what `sqlite-vec`
 *   stores in its index: the index pin is the dimension at insert
 *   time, not the buffer length at query time.
 *
 * Invariants:
 * - `vector.length === dimension`. Adapters MUST honour this; the
 *   downstream VO factory in retrieval refuses on mismatch.
 * - `dimension` is a positive integer.
 */
export interface RawEmbedding {
  readonly dimension: number;
  readonly vector: Float32Array;
}

/**
 * Driven (output) port: text → vector embedder, transversal flavour.
 *
 * Contracts:
 * - `embed(text)` returns one `RawEmbedding`; suitable for the recall
 *   query path.
 * - `embedBatch(texts)` returns one `RawEmbedding` per input, in the
 *   same order as the input. Adapters MAY parallelise internally;
 *   the result order is part of the contract.
 * - Empty input texts: implementations are free to reject or to
 *   return a zero-magnitude vector. The retrieval domain already
 *   handles zero-magnitude vectors gracefully
 *   (`EmbeddingVector.cosineDistance` returns 0 in that case), so
 *   either behaviour is acceptable; the adapter MUST document its
 *   choice.
 * - `dimension()` returns the dimension every embedding produced by
 *   THIS instance will have. The value is stable for the adapter's
 *   lifetime and equal to `embed(...).dimension` on success.
 */
export interface Embedder {
  /**
   * Computes the embedding of a single text.
   */
  embed(text: string): Promise<RawEmbedding>;

  /**
   * Computes embeddings for a batch of texts. The output array has
   * the same length and order as the input; the i-th output is the
   * embedding of the i-th input.
   */
  embedBatch(texts: readonly string[]): Promise<readonly RawEmbedding[]>;

  /**
   * Returns the dimension every embedding produced by this adapter
   * will have. Stable for the adapter's lifetime.
   */
  dimension(): number;
}
