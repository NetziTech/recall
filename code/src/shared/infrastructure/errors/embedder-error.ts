import { InfrastructureError } from "./infrastructure-error.ts";

export type EmbedderErrorCode =
  | "embedder.not-initialised"
  | "embedder.initialisation-failed"
  | "embedder.embed-failed"
  | "embedder.dimension-mismatch";

/**
 * Concrete error raised by embedder adapters (e.g.
 * `FastembedEmbedder`).
 *
 * Adapters lazy-load their underlying model on the first `embed()`
 * call; if a caller asks `dimension()` before the model is ready this
 * raises `embedder.not-initialised` so the composition root can route
 * to the FTS5-only fallback path
 * (`docs/01-arquitectura.md` §2.7).
 */
export class EmbedderError extends InfrastructureError {
  public readonly code: EmbedderErrorCode;

  private constructor(
    code: EmbedderErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.code = code;
  }

  public static notInitialised(operation: string): EmbedderError {
    return new EmbedderError(
      "embedder.not-initialised",
      `embedder cannot ${operation} before the model is loaded; call embed() first to lazy-init`,
    );
  }

  public static initialisationFailed(cause: unknown): EmbedderError {
    return new EmbedderError(
      "embedder.initialisation-failed",
      "embedder model failed to load",
      cause,
    );
  }

  public static embedFailed(cause: unknown): EmbedderError {
    return new EmbedderError(
      "embedder.embed-failed",
      "embedder failed to compute embedding",
      cause,
    );
  }

  public static dimensionMismatch(
    expected: number,
    actual: number,
  ): EmbedderError {
    return new EmbedderError(
      "embedder.dimension-mismatch",
      `embedder produced a vector of dimension ${String(actual)} but adapter is pinned at ${String(expected)}`,
    );
  }
}
