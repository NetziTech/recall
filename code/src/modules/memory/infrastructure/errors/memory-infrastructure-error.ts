import { InfrastructureError } from "../../../../shared/infrastructure/errors/infrastructure-error.ts";

/**
 * Concrete error raised by the memory module's infrastructure adapters.
 *
 * Mirrors the `CuratorInfrastructureError` / `SecretsInfrastructureError`
 * discriminator pattern: every adapter-level failure carries a stable
 * `code` so the application layer can route on it.
 *
 * Each `code` is scoped by adapter family (`memory.<adapter>.<error>`);
 * renaming a code is a breaking change.
 */
export type MemoryInfrastructureErrorCode =
  | "memory.persistence.row-malformed"
  | "memory.persistence.upsert-failed"
  | "memory.persistence.delete-failed"
  | "memory.persistence.query-failed"
  | "memory.embedding.enqueue-failed"
  | "memory.import.parse-failed"
  | "memory.export.serialize-failed"
  | "memory.handoff.parse-failed";

export class MemoryInfrastructureError extends InfrastructureError {
  public readonly code: MemoryInfrastructureErrorCode;

  private constructor(
    code: MemoryInfrastructureErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause);
    this.code = code;
  }

  public static rowMalformed(
    table: string,
    detail: string,
    cause?: unknown,
  ): MemoryInfrastructureError {
    return new MemoryInfrastructureError(
      "memory.persistence.row-malformed",
      `row in "${table}" failed validation: ${detail}`,
      cause,
    );
  }

  public static upsertFailed(
    table: string,
    cause: unknown,
  ): MemoryInfrastructureError {
    return new MemoryInfrastructureError(
      "memory.persistence.upsert-failed",
      `upsert into "${table}" failed`,
      cause,
    );
  }

  public static deleteFailed(
    table: string,
    cause: unknown,
  ): MemoryInfrastructureError {
    return new MemoryInfrastructureError(
      "memory.persistence.delete-failed",
      `delete from "${table}" failed`,
      cause,
    );
  }

  public static queryFailed(
    table: string,
    cause: unknown,
  ): MemoryInfrastructureError {
    return new MemoryInfrastructureError(
      "memory.persistence.query-failed",
      `query against "${table}" failed`,
      cause,
    );
  }

  public static embeddingEnqueueFailed(
    targetKind: string,
    targetRowId: string,
    cause: unknown,
  ): MemoryInfrastructureError {
    return new MemoryInfrastructureError(
      "memory.embedding.enqueue-failed",
      `embedding enqueue for (kind="${targetKind}", id="${targetRowId}") failed`,
      cause,
    );
  }

  public static importParseFailed(
    detail: string,
    cause?: unknown,
  ): MemoryInfrastructureError {
    return new MemoryInfrastructureError(
      "memory.import.parse-failed",
      `import payload parse failed: ${detail}`,
      cause,
    );
  }

  public static exportSerializeFailed(
    detail: string,
    cause?: unknown,
  ): MemoryInfrastructureError {
    return new MemoryInfrastructureError(
      "memory.export.serialize-failed",
      `export payload serialize failed: ${detail}`,
      cause,
    );
  }

  public static handoffParseFailed(
    detail: string,
    cause?: unknown,
  ): MemoryInfrastructureError {
    return new MemoryInfrastructureError(
      "memory.handoff.parse-failed",
      `HANDOFF.md parse failed: ${detail}`,
      cause,
    );
  }
}
