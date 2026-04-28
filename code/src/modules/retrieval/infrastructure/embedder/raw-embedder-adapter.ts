import type {
  Embedder as RawEmbedder,
  RawEmbedding,
} from "../../../../shared/application/ports/embedder.port.ts";
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
 * Errors:
 * - Propagates the underlying adapter's errors unchanged. Callers (the
 *   `RecallMemoryUseCase`) catch them and degrade to FTS5-only.
 */
export class RawEmbedderAdapter implements Embedder {
  public constructor(private readonly raw: RawEmbedder) {}

  public async embed(text: string): Promise<EmbeddingVector> {
    const out = await this.raw.embed(text);
    return RawEmbedderAdapter.toVector(out);
  }

  public async embedBatch(
    texts: readonly string[],
  ): Promise<readonly EmbeddingVector[]> {
    const outs = await this.raw.embedBatch(texts);
    const result: EmbeddingVector[] = [];
    for (const r of outs) {
      result.push(RawEmbedderAdapter.toVector(r));
    }
    return Object.freeze(result);
  }

  private static toVector(raw: RawEmbedding): EmbeddingVector {
    if (raw.vector.length !== raw.dimension) {
      // The raw port's contract guarantees this invariant, but the
      // adapter checks it as defence-in-depth: a misbehaving backend
      // would otherwise produce a VO whose `dim()` lies about its
      // length, and the cosine kernel would silently produce wrong
      // numbers.
      throw new Error(
        `embedder produced vector of length ${String(raw.vector.length)} but reported dimension ${String(raw.dimension)}`,
      );
    }
    return EmbeddingVector.create(raw.vector);
  }
}
