/**
 * Base class for errors raised by the retrieval infrastructure layer.
 *
 * Mirrors the `*InfrastructureError` pattern from
 * `shared/infrastructure/errors/infrastructure-error.ts` and
 * `secrets/infrastructure/errors/secrets-infrastructure-error.ts`:
 * a single tagged hierarchy so the application layer can route every
 * adapter failure with one `instanceof` test.
 *
 * Invariants:
 * - `code` is a stable kebab-case identifier (e.g.
 *   `retrieval.tiktoken-load-failed`).
 * - The `cause` slot is non-enumerable so `JSON.stringify(error)`
 *   does not leak the underlying driver's internals to logs.
 */
export abstract class RetrievalInfrastructureError extends Error {
  public abstract readonly code: string;

  protected constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = new.target.name;
    if (options?.cause !== undefined) {
      Object.defineProperty(this, "cause", {
        value: options.cause,
        enumerable: false,
        writable: false,
        configurable: true,
      });
    }
  }

  /**
   * Convenience factory for "the tiktoken adapter could not load
   * the encoder". The composition root catches this and treats it
   * as fatal at start-up.
   */
  public static tiktokenLoadFailed(cause: unknown): RetrievalInfrastructureError {
    return new TiktokenLoadFailedError(cause);
  }

  /**
   * Convenience factory for "the worker observed a permanent
   * failure on a queue item". Surfaced for observability; not a
   * fatal condition.
   */
  public static permanentEmbeddingFailure(
    queueId: string,
    attempts: number,
  ): RetrievalInfrastructureError {
    return new PermanentEmbeddingFailureError(queueId, attempts);
  }
}

class TiktokenLoadFailedError extends RetrievalInfrastructureError {
  public readonly code = "retrieval.tiktoken-load-failed";

  public constructor(cause: unknown) {
    super("tiktoken encoder could not be loaded", { cause });
  }
}

class PermanentEmbeddingFailureError extends RetrievalInfrastructureError {
  public readonly code = "retrieval.permanent-embedding-failure";
  public readonly queueId: string;
  public readonly attempts: number;

  public constructor(queueId: string, attempts: number) {
    super(
      `embedding queue item ${queueId} reached permanent failure after ${String(attempts)} attempts`,
    );
    this.queueId = queueId;
    this.attempts = attempts;
  }
}
