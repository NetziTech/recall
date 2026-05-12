import { InfrastructureError } from "../../../../shared/infrastructure/errors/infrastructure-error.ts";

/**
 * Concrete error raised by the workspace module's infrastructure
 * adapters and by the use cases when an application-level
 * pre-condition fails (e.g. "you asked to unlock a path with no
 * workspace").
 *
 * Lives in `infrastructure/errors/` rather than in
 * `domain/errors/` because none of these conditions express a domain
 * invariant violation: they all describe a problem with the
 * surrounding world (filesystem, missing files, permission denied,
 * caller pointed at the wrong directory). Surfacing them as
 * `InfrastructureError` lets the CLI map them to the documented
 * `invalidConfig` exit code (`docs/07-instalacion.md` §7) and lets
 * the MCP transport layer surface them as standard JSON-RPC
 * `INTERNAL_ERROR` (-32603).
 *
 * The `code` field is one of the kebab-case identifiers in
 * {@link WorkspaceInfrastructureErrorCode}; callers SHOULD pattern
 * match on it rather than parse `message`.
 *
 * Construction is via static factories so the `code` literal cannot
 * drift from the discriminator type.
 *
 * Path/identifier redaction (W-3.5-SEC-L2, mirrors PR #45 / DatabaseError):
 * - Filesystem paths (workspace root, start path, hook path) are
 *   stored in the structured {@link WorkspaceInfrastructureError.details}
 *   bag, NOT concatenated into `message`. Pino redacts structured
 *   keys (`details.path` is in `DEFAULT_REDACT_PATHS`) but does NOT
 *   inspect message content — keeping paths out of the message is
 *   what makes them redactable when these errors flow through the
 *   logger. The JSON-RPC wire mapper only surfaces `message` to
 *   clients, so this also prevents path-leaks to remote callers.
 * - Callers that need the path read it from `details.path`. Tests
 *   that previously asserted on `error.message` substring should
 *   pivot to `error.details.path`.
 */
export type WorkspaceInfrastructureErrorCode =
  | "workspace.config-missing"
  | "workspace.config-malformed"
  | "workspace.config-write-failed"
  | "workspace.config-read-failed"
  | "workspace.directory-create-failed"
  | "workspace.directory-remove-failed"
  | "workspace.gitignore-update-failed"
  | "workspace.detection-failed"
  | "workspace.unlock-target-missing";

/**
 * Structured side-channel for sensitive identifiers attached to a
 * {@link WorkspaceInfrastructureError}.
 *
 * Mirrors the {@link import("../../../../shared/infrastructure/errors/database-error.ts").DatabaseErrorDetails}
 * shape: lowercase ASCII keys, JSON-serializable primitive values,
 * no nested objects (keeps pino redact globs `*.details.path` clean
 * without needing `**` recursion).
 */
export type WorkspaceInfrastructureErrorDetails = Readonly<Record<string, unknown>>;

export class WorkspaceInfrastructureError extends InfrastructureError {
  public readonly code: WorkspaceInfrastructureErrorCode;

  /**
   * Structured fields that supplement {@link Error.message} without
   * appearing inside the message string. Always defined (empty object
   * when a factory has nothing to attach) so callers can dot-access
   * `details.path` without an undefined-guard.
   */
  public readonly details: WorkspaceInfrastructureErrorDetails;

  private constructor(
    code: WorkspaceInfrastructureErrorCode,
    message: string,
    details: WorkspaceInfrastructureErrorDetails,
    cause?: unknown,
  ) {
    super(message, cause);
    this.code = code;
    this.details = details;
  }

  public static configMissing(rootPath: string): WorkspaceInfrastructureError {
    return new WorkspaceInfrastructureError(
      "workspace.config-missing",
      "no .recall/config.json found at the expected location",
      { path: rootPath },
    );
  }

  public static configMalformed(
    rootPath: string,
    detail: string,
  ): WorkspaceInfrastructureError {
    return new WorkspaceInfrastructureError(
      "workspace.config-malformed",
      `failed to parse .recall/config.json: ${detail}`,
      { path: rootPath, detail },
    );
  }

  public static configReadFailed(
    rootPath: string,
    cause: unknown,
  ): WorkspaceInfrastructureError {
    return new WorkspaceInfrastructureError(
      "workspace.config-read-failed",
      "failed to read .recall/config.json",
      { path: rootPath },
      cause,
    );
  }

  public static configWriteFailed(
    rootPath: string,
    cause: unknown,
  ): WorkspaceInfrastructureError {
    return new WorkspaceInfrastructureError(
      "workspace.config-write-failed",
      "failed to write .recall/config.json",
      { path: rootPath },
      cause,
    );
  }

  public static directoryCreateFailed(
    rootPath: string,
    cause: unknown,
  ): WorkspaceInfrastructureError {
    return new WorkspaceInfrastructureError(
      "workspace.directory-create-failed",
      "failed to create .recall/ workspace directory",
      { path: rootPath },
      cause,
    );
  }

  public static directoryRemoveFailed(
    rootPath: string,
    cause: unknown,
  ): WorkspaceInfrastructureError {
    return new WorkspaceInfrastructureError(
      "workspace.directory-remove-failed",
      "failed to remove .recall/ workspace directory",
      { path: rootPath },
      cause,
    );
  }

  public static gitignoreUpdateFailed(
    rootPath: string,
    cause: unknown,
  ): WorkspaceInfrastructureError {
    return new WorkspaceInfrastructureError(
      "workspace.gitignore-update-failed",
      "failed to update .gitignore in workspace root",
      { path: rootPath },
      cause,
    );
  }

  public static detectionFailed(
    startPath: string,
    cause: unknown,
  ): WorkspaceInfrastructureError {
    return new WorkspaceInfrastructureError(
      "workspace.detection-failed",
      "failed to detect a workspace upward from the requested start path",
      { path: startPath },
      cause,
    );
  }

  public static unlockTargetMissing(
    rootPath: string,
  ): WorkspaceInfrastructureError {
    return new WorkspaceInfrastructureError(
      "workspace.unlock-target-missing",
      "cannot unlock: no workspace found at or above the requested path",
      { path: rootPath },
    );
  }
}
