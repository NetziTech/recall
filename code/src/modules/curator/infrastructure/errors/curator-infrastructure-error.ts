import { InfrastructureError } from "../../../../shared/infrastructure/errors/infrastructure-error.ts";

/**
 * Concrete error raised by the curator's infrastructure adapters.
 *
 * Mirrors the `SecretsInfrastructureError` discriminator pattern: every
 * adapter-level failure carries a stable `code` so the application
 * layer can route on it.
 *
 * Each `code` is scoped by adapter family
 * (`curator.<adapter>.<error>`); renaming a code is a breaking
 * change.
 */
export type CuratorInfrastructureErrorCode =
  | "curator.persistence.row-malformed"
  | "curator.persistence.upsert-failed"
  | "curator.persistence.unsupported-kind"
  | "curator.similarity.embedding-missing"
  | "curator.filesystem.scan-failed";

export class CuratorInfrastructureError extends InfrastructureError {
  public readonly code: CuratorInfrastructureErrorCode;

  private constructor(
    code: CuratorInfrastructureErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.code = code;
  }

  public static rowMalformed(
    table: string,
    detail: string,
    cause?: unknown,
  ): CuratorInfrastructureError {
    return new CuratorInfrastructureError(
      "curator.persistence.row-malformed",
      `row in "${table}" failed validation: ${detail}`,
      cause,
    );
  }

  public static upsertFailed(
    table: string,
    cause: unknown,
  ): CuratorInfrastructureError {
    return new CuratorInfrastructureError(
      "curator.persistence.upsert-failed",
      `upsert into "${table}" failed`,
      cause,
    );
  }

  public static unsupportedKind(
    operation: string,
    kind: string,
  ): CuratorInfrastructureError {
    return new CuratorInfrastructureError(
      "curator.persistence.unsupported-kind",
      `operation "${operation}" does not support kind "${kind}"`,
    );
  }

  public static scanFailed(
    rootPath: string,
    cause: unknown,
  ): CuratorInfrastructureError {
    return new CuratorInfrastructureError(
      "curator.filesystem.scan-failed",
      `path probe under workspace root "${rootPath}" failed`,
      cause,
    );
  }
}
