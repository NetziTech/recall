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
 *
 * Path/identifier redaction (W-3.5-SEC-L2, mirrors PR #45):
 * - The absolute workspace path attached to `scanFailed(...)` lives
 *   in `details.path`, NOT in `message`. Pino redacts
 *   `details.path` / `*.details.path` via `DEFAULT_REDACT_PATHS`,
 *   and the JSON-RPC wire mapper only surfaces `message` to clients
 *   — keeping the path out of `message` blocks both leak vectors.
 */
export type CuratorInfrastructureErrorCode =
  | "curator.persistence.row-malformed"
  | "curator.persistence.upsert-failed"
  | "curator.persistence.unsupported-kind"
  | "curator.similarity.embedding-missing"
  | "curator.filesystem.scan-failed";

/**
 * Structured side-channel for sensitive identifiers attached to a
 * {@link CuratorInfrastructureError}. Same shape as the workspace
 * tier (lowercase ASCII keys, JSON-serializable primitives, no
 * nested objects) so the pino redact globs work without `**`.
 */
export type CuratorInfrastructureErrorDetails = Readonly<Record<string, unknown>>;

export class CuratorInfrastructureError extends InfrastructureError {
  public readonly code: CuratorInfrastructureErrorCode;

  /**
   * Structured fields that supplement {@link Error.message} without
   * appearing inside the message string. Always defined (empty object
   * when a factory has nothing to attach) so callers can dot-access
   * `details.path` without an undefined-guard.
   */
  public readonly details: CuratorInfrastructureErrorDetails;

  private constructor(
    code: CuratorInfrastructureErrorCode,
    message: string,
    details: CuratorInfrastructureErrorDetails,
    cause?: unknown,
  ) {
    super(message, cause);
    this.code = code;
    this.details = details;
  }

  public static rowMalformed(
    table: string,
    detail: string,
    cause?: unknown,
  ): CuratorInfrastructureError {
    return new CuratorInfrastructureError(
      "curator.persistence.row-malformed",
      `row in "${table}" failed validation: ${detail}`,
      { table, detail },
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
      { table },
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
      { operation, kind },
    );
  }

  public static scanFailed(
    rootPath: string,
    cause: unknown,
  ): CuratorInfrastructureError {
    return new CuratorInfrastructureError(
      "curator.filesystem.scan-failed",
      "path probe under workspace root failed",
      { path: rootPath },
      cause,
    );
  }
}
