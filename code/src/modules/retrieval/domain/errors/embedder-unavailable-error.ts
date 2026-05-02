import { RetrievalDomainError } from "./retrieval-domain-error.ts";

/**
 * Raised when the embedder cannot serve ANY request right now — the
 * model is loading (cold-start), the network is down, the cache is
 * corrupt, or the underlying adapter is otherwise in a transport-level
 * failure mode that affects every input equally.
 *
 * Why this error type exists (B-MCP-7, issue #24):
 * - The `AsyncEmbeddingWorker` previously treated EVERY embedder
 *   rejection as a per-item failure, incrementing `attempts` on the
 *   queue row each time. During a fastembed cold-start (model download
 *   + ONNX session creation, ~4.3 s), the worker would burn through
 *   `MAX_ATTEMPTS=5` per item in milliseconds (when the underlying
 *   error fast-fails, e.g. a partial cache directory) before the model
 *   finished loading, marking 32 items as permanent failures in the
 *   same batch.
 * - The fix is to discriminate: transport-level failures (this error)
 *   tell the worker to back off the WHOLE batch — without incrementing
 *   per-item attempts — so the cold-start has time to complete; only
 *   {@link EmbedFailedError} bumps per-item attempts.
 *
 * Behavioural contract:
 * - Callers (worker, recall fallback path) MUST treat this as
 *   "embedder is temporarily unavailable" and retry later. The queue
 *   row's `attempts` MUST NOT be incremented in this branch.
 * - The optional `retryAfterMs` carries the adapter's hint about how
 *   long to wait before the next attempt (e.g. 4 000 ms for a typical
 *   fastembed cold-start). When `null`, the caller picks its own
 *   exponential back-off schedule.
 *
 * Invariants:
 * - `code` is the stable identifier `retrieval.embedder-unavailable`.
 * - `jsonRpcCode` is `null`: the protocol catalog does not allocate a
 *   wire code for this; recall surfaces it as `fallback_reason:
 *   "embedder_unavailable"` (`docs/01-arquitectura.md` §2.7).
 * - `retryAfterMs` is a positive integer when present.
 */
export class EmbedderUnavailableError extends RetrievalDomainError {
  public readonly code = "retrieval.embedder-unavailable";
  public readonly jsonRpcCode: number | null = null;
  public readonly retryAfterMs: number | null;

  public constructor(
    message: string,
    options?: { retryAfterMs?: number; cause?: unknown },
  ) {
    super(
      message,
      options?.cause === undefined ? undefined : { cause: options.cause },
    );
    this.retryAfterMs = options?.retryAfterMs ?? null;
  }
}
