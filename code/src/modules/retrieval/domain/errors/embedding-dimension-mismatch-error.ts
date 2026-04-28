import { RetrievalDomainError } from "./retrieval-domain-error.ts";

/**
 * Raised when two `EmbeddingVector` instances of different
 * dimensionality are compared (e.g. a 384-d vector against a 768-d
 * vector). Cosine similarity over mismatched dimensions is undefined,
 * so the VO refuses the operation rather than silently producing a
 * meaningless score.
 *
 * The most common cause is a model swap (`docs/03-modelo-datos.md` §6
 * — the curator re-embeds when `embedding_metadata.model_name` drifts
 * from the active model). While the curator is mid-migration, the
 * vectors store mixes old and new dimensions; the recall pipeline must
 * detect the mismatch and fall back to FTS5-only ranking
 * (`docs/01-arquitectura.md` §2.7) instead of crashing.
 *
 * Invariants:
 * - `code` is the stable identifier
 *   `retrieval.embedding-dimension-mismatch`.
 * - `expectedDim` and `actualDim` are positive integers that differ
 *   (otherwise the error would never be raised).
 * - `jsonRpcCode` is `null`: the protocol catalog does not allocate a
 *   wire code; adapters usually treat this as a soft fallback signal,
 *   not as a user-visible error.
 */
export class EmbeddingDimensionMismatchError extends RetrievalDomainError {
  public readonly code = "retrieval.embedding-dimension-mismatch";
  public readonly jsonRpcCode: number | null = null;
  public readonly expectedDim: number;
  public readonly actualDim: number;

  public constructor(
    input: { expectedDim: number; actualDim: number },
    options?: { cause?: unknown },
  ) {
    super(
      `embedding dimension mismatch: expected ${String(
        input.expectedDim,
      )}, got ${String(input.actualDim)}`,
      options !== undefined ? { cause: options.cause } : undefined,
    );
    this.expectedDim = input.expectedDim;
    this.actualDim = input.actualDim;
  }
}
