import type {
  Embedder as RawEmbedder,
  RawEmbedding,
} from "../../../../shared/application/ports/embedder.port.ts";
import { EmbedderError } from "../../../../shared/infrastructure/errors/embedder-error.ts";
import { EmbedFailedError } from "../../domain/errors/embed-failed-error.ts";
import { EmbedderUnavailableError } from "../../domain/errors/embedder-unavailable-error.ts";
import type { Embedder } from "../../domain/services/embedder.ts";
import { EmbeddingVector } from "../../domain/value-objects/embedding-vector.ts";

/**
 * Adapter that lifts the cross-module `Embedder` port from
 * `shared/application/ports/embedder.port.ts` into the retrieval-flavoured
 * `Embedder` port from `domain/services/embedder.ts`.
 *
 * Why two ports for the same concept (D-023):
 * - The `shared/` port speaks `Float32Array` + `dimension` so it can
 *   live in `shared/` without re-introducing the cross-module
 *   dependency `shared` → `retrieval` for the `EmbeddingVector` VO
 *   (the VO is owned by the retrieval bounded context). The retrieval
 *   adapter (this class) wraps the raw output into the VO.
 * - The retrieval port speaks `EmbeddingVector` so the recall
 *   pipeline and the bundle assembler keep working with a domain VO
 *   end-to-end. No primitive obsession in the use cases.
 *
 * The composition root binds both names to the same backend (e.g. the
 * `FastembedEmbedder` from `shared/infrastructure/embedder/`):
 * ```typescript
 * const fastembed = await FastembedEmbedder.create({...});
 * const retrievalEmbedder = new RawEmbedderAdapter(fastembed);
 * ```
 *
 * Performance:
 * - Each call wraps the raw `Float32Array` into an `EmbeddingVector`,
 *   which allocates a defensive copy (the VO factory always copies so
 *   the buffer cannot be mutated externally). The copy is in the hot
 *   path of recall but is bounded by the embedder's own latency
 *   (50–200 ms per call vs ~5 µs for a 384-float copy).
 *
 * Errors (translation layer — B-MCP-7, issue #24):
 * - The shared `EmbedderError` carries a stable `code` discriminant
 *   that the adapter maps onto the retrieval domain error union:
 *     - `embedder.initialisation-failed` and `embedder.not-initialised`
 *       → {@link EmbedderUnavailableError}: the model is not loaded yet
 *       (cold start in flight, network down, cache corrupt). The
 *       worker MUST back off the whole batch.
 *     - `embedder.embed-failed` → {@link EmbedFailedError}: the model
 *       rejected this specific input. The worker bumps per-item
 *       attempts.
 *     - `embedder.dimension-mismatch` → {@link EmbedFailedError}: the
 *       adapter produced a vector whose length disagrees with its
 *       pinned dimension. Treated as per-item because retrying the
 *       same input on the same broken adapter is unlikely to recover,
 *       so the per-item attempts cap eventually drains it.
 * - Unknown / non-`EmbedderError` causes are wrapped as
 *   {@link EmbedFailedError} (conservative default — only the explicit
 *   "unavailable" codes earn the back-off treatment).
 *
 * Why translate at the adapter (not at the worker):
 * - The worker reads the retrieval `Embedder` port which lives in the
 *   domain layer; the domain MUST NOT depend on `shared/infrastructure`
 *   error classes (Hexagonal direction-of-dependency rule). The
 *   translation lives in the adapter, which is the only seam that
 *   touches both the shared backend and the retrieval domain.
 */
export class RawEmbedderAdapter implements Embedder {
  public constructor(private readonly raw: RawEmbedder) {}

  public async embed(text: string): Promise<EmbeddingVector> {
    let out: RawEmbedding;
    try {
      out = await this.raw.embed(text);
    } catch (cause: unknown) {
      throw RawEmbedderAdapter.translateError(cause);
    }
    return RawEmbedderAdapter.toVector(out);
  }

  public async embedBatch(
    texts: readonly string[],
  ): Promise<readonly EmbeddingVector[]> {
    let outs: readonly RawEmbedding[];
    try {
      outs = await this.raw.embedBatch(texts);
    } catch (cause: unknown) {
      throw RawEmbedderAdapter.translateError(cause);
    }
    const result: EmbeddingVector[] = [];
    for (const r of outs) {
      result.push(RawEmbedderAdapter.toVector(r));
    }
    return Object.freeze(result);
  }

  private static translateError(cause: unknown): Error {
    if (cause instanceof EmbedderError) {
      switch (cause.code) {
        case "embedder.initialisation-failed":
        case "embedder.not-initialised":
          return new EmbedderUnavailableError(cause.message, undefined, cause);
        case "embedder.embed-failed":
        case "embedder.dimension-mismatch":
          return new EmbedFailedError(cause.message, cause);
      }
    }
    const message = cause instanceof Error ? cause.message : String(cause);
    return new EmbedFailedError(message, cause);
  }

  private static toVector(raw: RawEmbedding): EmbeddingVector {
    if (raw.vector.length !== raw.dimension) {
      // The raw port's contract guarantees this invariant, but the
      // adapter checks it as defence-in-depth: a misbehaving backend
      // would otherwise produce a VO whose `dim()` lies about its
      // length, and the cosine kernel would silently produce wrong
      // numbers.
      throw new EmbedFailedError(
        `embedder produced vector of length ${String(raw.vector.length)} but reported dimension ${String(raw.dimension)}`,
      );
    }
    return EmbeddingVector.create(raw.vector);
  }
}
