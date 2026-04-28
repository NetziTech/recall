import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";
import { EmbeddingDimensionMismatchError } from "../errors/embedding-dimension-mismatch-error.ts";
import { CosineScore } from "./cosine-score.ts";

/**
 * Value object encapsulating an embedding vector — a fixed-length array
 * of `Float32` components produced by the active embedder.
 *
 * Why `Float32Array` rather than `readonly number[]`:
 * - `fastembed-js` and the sqlite-vec adapter both work in `Float32`
 *   precision (`docs/06-stack-tecnico.md` §6, §7). Round-tripping
 *   through a `number[]` would force a copy on every read and drop
 *   precision opportunistically.
 * - The dimension is fixed at construction; `Float32Array` carries that
 *   length on the buffer itself, which keeps the invariant cheap to
 *   check.
 *
 * Immutability:
 * - `Float32Array` is a JS-mutable structure. The factory `create(...)`
 *   makes a defensive copy so callers cannot mutate the wrapped buffer
 *   after the VO is built. The `withVector(callback)` accessor exposes
 *   a *reference* to the internal buffer so high-throughput consumers
 *   (cosine kernel, bulk-norm checks) avoid the per-call copy; the
 *   callback contract MUST treat the buffer as read-only — the docstring
 *   spells that out and there is no enforcement (the alternative would
 *   be wrapping every read in a `Proxy`, which is too expensive for hot
 *   paths).
 *
 * Invariants:
 * - `dim()` returns a positive integer (rejects zero-length vectors).
 * - Every component is finite. NaN/Infinity values are rejected at
 *   construction.
 * - `cosineDistance(other)` refuses to compute on mismatched dimensions
 *   and raises `EmbeddingDimensionMismatchError` (see the error
 *   docstring for the rationale).
 *
 * Equality:
 * - Two `EmbeddingVector` are equal iff they have the same dimension
 *   and every component matches exactly. Use `cosineDistance(other)`
 *   for fuzzy comparison.
 */
export class EmbeddingVector {
  private readonly buffer: Float32Array;

  private constructor(buffer: Float32Array) {
    this.buffer = buffer;
  }

  /**
   * Builds an `EmbeddingVector` from a numeric source. Always copies
   * the input into a fresh `Float32Array` so the VO owns the memory.
   *
   * Accepts either a `Float32Array` (typical when reading from
   * sqlite-vec) or a plain `readonly number[]` (typical when parsing
   * JSON payloads).
   */
  public static create(
    components: Float32Array | readonly number[],
  ): EmbeddingVector {
    // Branch on the concrete representation rather than a unified
    // `instanceof + Array.isArray` guard: `Array.isArray` widens
    // `readonly number[]` to `any[]` in TypeScript's lib typings, which
    // cascades into `any` element-access types and contaminates the
    // hot loop below. Splitting the validation per branch keeps both
    // sides strictly typed and lets the linter see `number | undefined`
    // for the array branch and `number` for the typed-array branch.
    if (components instanceof Float32Array) {
      const length = components.length;
      if (length === 0) {
        throw new InvalidInputError(
          "embedding vector must contain at least one component",
          { field: "embedding" },
        );
      }
      const buffer = new Float32Array(length);
      for (let i = 0; i < length; i += 1) {
        const raw = components[i];
        if (raw === undefined || !Number.isFinite(raw)) {
          throw new InvalidInputError(
            `embedding vector component at index ${String(i)} must be a finite number`,
            { field: `embedding[${String(i)}]` },
          );
        }
        buffer[i] = raw;
      }
      return new EmbeddingVector(buffer);
    }
    if (!Array.isArray(components)) {
      throw new InvalidInputError(
        "embedding vector must be a Float32Array or a number[]",
        { field: "embedding" },
      );
    }
    const arr = components as readonly number[];
    const length = arr.length;
    if (length === 0) {
      throw new InvalidInputError(
        "embedding vector must contain at least one component",
        { field: "embedding" },
      );
    }
    const buffer = new Float32Array(length);
    for (let i = 0; i < length; i += 1) {
      const raw = arr[i];
      if (raw === undefined || !Number.isFinite(raw)) {
        throw new InvalidInputError(
          `embedding vector component at index ${String(i)} must be a finite number`,
          { field: `embedding[${String(i)}]` },
        );
      }
      buffer[i] = raw;
    }
    return new EmbeddingVector(buffer);
  }

  /**
   * Number of components in the vector. Stable for the lifetime of the
   * VO.
   */
  public dim(): number {
    return this.buffer.length;
  }

  /**
   * Computes the cosine *distance* `1 - cos(theta)` between this vector
   * and `other`. Returns a number in `[0, 2]`.
   *
   * Refuses to compute when the dimensions differ (raises
   * `EmbeddingDimensionMismatchError`). Two zero-magnitude vectors are
   * defined as having a cosine distance of `0` (perfectly similar) so
   * the recall pipeline does not have to special-case the all-zero
   * fallback the embedder may produce on degenerate inputs.
   */
  public cosineDistance(other: EmbeddingVector): number {
    if (this.buffer.length !== other.buffer.length) {
      throw new EmbeddingDimensionMismatchError({
        expectedDim: this.buffer.length,
        actualDim: other.buffer.length,
      });
    }
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < this.buffer.length; i += 1) {
      const a = this.buffer[i] ?? 0;
      const b = other.buffer[i] ?? 0;
      dot += a * b;
      normA += a * a;
      normB += b * b;
    }
    if (normA === 0 || normB === 0) return 0;
    const similarity = dot / (Math.sqrt(normA) * Math.sqrt(normB));
    const clampedSimilarity =
      similarity > 1 ? 1 : similarity < -1 ? -1 : similarity;
    return 1 - clampedSimilarity;
  }

  /**
   * Convenience: returns the cosine *similarity* in `[0, 1]` shape
   * directly (i.e. wrapped in a `CosineScore`). Negative cosine values
   * are clamped to `0` per the `CosineScore` contract.
   */
  public cosineSimilarityTo(other: EmbeddingVector): CosineScore {
    return CosineScore.fromDistance(this.cosineDistance(other));
  }

  /**
   * Read-only access to the underlying buffer through a callback. The
   * buffer reference is the VO's own, NOT a copy — the callback MUST
   * NOT mutate it. Used by hot paths (bulk cosine over tens of thousands
   * of candidates) where the per-call copy of `toFloat32Array` would
   * dominate the runtime.
   *
   * The contract is documented and enforced socially, not at runtime.
   * Adapters that violate it will silently corrupt the VO; the recall
   * unit tests verify the invariant indirectly (cosine of `(v, v)` is
   * `0` after a sequence of reads — if the callback mutated the buffer
   * mid-flight the assertion would fail).
   */
  public withVector<T>(callback: (buffer: Float32Array) => T): T {
    return callback(this.buffer);
  }

  /**
   * Returns a defensive copy of the underlying buffer. Use this when
   * the consumer needs to retain a reference (e.g. caching, threading
   * through a worker). High-frequency cosine paths should use
   * `withVector(callback)` instead.
   */
  public toFloat32Array(): Float32Array {
    const copy = new Float32Array(this.buffer.length);
    copy.set(this.buffer);
    return copy;
  }

  public equals(other: EmbeddingVector): boolean {
    if (this === other) return true;
    if (this.buffer.length !== other.buffer.length) return false;
    for (let i = 0; i < this.buffer.length; i += 1) {
      if (this.buffer[i] !== other.buffer[i]) return false;
    }
    return true;
  }
}
