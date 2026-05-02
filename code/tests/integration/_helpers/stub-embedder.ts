/**
 * Deterministic stub `Embedder` for integration tests.
 *
 * The composition root wires the production wiring with `FastembedEmbedder`
 * (which downloads ONNX weights on first call). For integration tests we
 * never want a network roundtrip, so this stub:
 *
 *   - Returns a deterministic 384-dim `Float32Array` derived from a hash
 *     of the input text — the same string maps to the same vector across
 *     runs, which lets recall/recall-context tests assert ranking.
 *   - Optionally fails on demand (set `failNext = true` to drive the
 *     `embedder_unavailable` fallback documented in
 *     `docs/01-arquitectura.md` §2.7).
 *
 * The stub honours BOTH ports the application sees:
 *   - `Embedder` (raw, `Float32Array` + dimension) from `shared/`.
 *   - `Embedder` (retrieval-flavoured, `EmbeddingVector`) — for the
 *     retrieval flavour the test wires a `RawEmbedderAdapter` over THIS
 *     instance, exactly as the production root does.
 */
import type {
  Embedder as RawEmbedder,
  RawEmbedding,
} from "../../../src/shared/application/ports/embedder.port.ts";

const DIM = 384;

/**
 * Cheap, stable hash of a string into a 32-bit integer. FNV-1a.
 */
function fnv1aHash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Builds a deterministic 384-dim vector from a 32-bit seed using a
 * Lehmer LCG. The vector is L2-unit-norm so cosine similarity values
 * stay in `[-1, 1]`.
 */
function deterministicVector(seed: number): Float32Array {
  let state = seed === 0 ? 0xdeadbeef : seed;
  const out = new Float32Array(DIM);
  let sumSq = 0;
  for (let i = 0; i < DIM; i += 1) {
    state = Math.imul(state, 48271) >>> 0;
    // Map to [-1, 1)
    const v = state / 0x80000000 - 1;
    out[i] = v;
    sumSq += v * v;
  }
  const norm = Math.sqrt(sumSq);
  if (norm > 0) {
    for (let i = 0; i < DIM; i += 1) {
      out[i] = (out[i] ?? 0) / norm;
    }
  }
  return out;
}

/**
 * Mutable, recording stub for the `Embedder` port. Each `embed` call
 * records the input text so tests can verify dispatch.
 */
export class StubRawEmbedder implements RawEmbedder {
  public readonly calls: string[] = [];
  public failNext = false;
  public failPersistently = false;
  /**
   * Queue of errors to throw on the next N `embed` / `embedBatch`
   * calls (in order). Used by integration tests to simulate the
   * fastembed cold-start path (B-MCP-7) where the first calls reject
   * with `EmbedderError.initialisationFailed` until the model is
   * loaded. After the queue empties, normal behaviour resumes.
   */
  public nextErrors: Error[] = [];
  private readonly dim: number;

  public constructor(options: { readonly dimension?: number } = {}) {
    this.dim = options.dimension ?? DIM;
  }

  public dimension(): number {
    return this.dim;
  }

  public embed(text: string): Promise<RawEmbedding> {
    this.calls.push(text);
    if (this.nextErrors.length > 0) {
      const err = this.nextErrors.shift();
      // shift only returns undefined for an empty array; the length
      // guard above proves we have an entry, so the assertion stays
      // null-safe without an `as` cast.
      if (err !== undefined) return Promise.reject(err);
    }
    if (this.failPersistently) {
      return Promise.reject(new Error("stub embedder: persistent failure"));
    }
    if (this.failNext) {
      this.failNext = false;
      return Promise.reject(new Error("stub embedder: failNext was set"));
    }
    return Promise.resolve({
      dimension: this.dim,
      vector: deterministicVector(fnv1aHash(text)),
    });
  }

  public embedBatch(
    texts: readonly string[],
  ): Promise<readonly RawEmbedding[]> {
    if (this.nextErrors.length > 0) {
      const err = this.nextErrors.shift();
      if (err !== undefined) return Promise.reject(err);
    }
    if (this.failPersistently) {
      return Promise.reject(new Error("stub embedder: persistent failure"));
    }
    const out: RawEmbedding[] = [];
    for (const t of texts) {
      this.calls.push(t);
      out.push({
        dimension: this.dim,
        vector: deterministicVector(fnv1aHash(t)),
      });
    }
    return Promise.resolve(Object.freeze(out));
  }
}
