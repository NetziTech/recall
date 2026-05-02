import { RetrievalDomainError } from "./retrieval-domain-error.ts";

/**
 * Raised when the embedder rejected THIS specific input — the text was
 * malformed, exceeded the maximum token length the model can encode,
 * or hit some other per-input rejection from the underlying adapter
 * (e.g. dimension mismatch).
 *
 * Pairs with {@link EmbedderUnavailableError}: this error means
 * "retrying THIS input is unlikely to succeed; bump per-item attempts
 * and let the back-off window decide whether to dequeue again". The
 * unavailable error means "the embedder is down for everyone; back off
 * the WHOLE batch without penalising any item".
 *
 * Behavioural contract:
 * - The `AsyncEmbeddingWorker` MUST increment the queue row's
 *   `attempts` counter in this branch and, after the per-item
 *   `MAX_ATTEMPTS` cap, stop retrying.
 *
 * Invariants:
 * - `code` is the stable identifier `retrieval.embed-failed`.
 * - `jsonRpcCode` is `null`: the protocol catalog does not allocate a
 *   wire code; recall surfaces it as `fallback_reason:
 *   "embedder_unavailable"` (the surface symptom is the same as the
 *   transport-level case).
 */
export class EmbedFailedError extends RetrievalDomainError {
  public readonly code = "retrieval.embed-failed";
  public readonly jsonRpcCode: number | null = null;

  public constructor(message: string, options?: { cause?: unknown }) {
    super(
      message,
      options?.cause !== undefined ? { cause: options.cause } : undefined,
    );
  }
}
