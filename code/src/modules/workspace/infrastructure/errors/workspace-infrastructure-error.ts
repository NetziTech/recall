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

export class WorkspaceInfrastructureError extends InfrastructureError {
  public readonly code: WorkspaceInfrastructureErrorCode;

  private constructor(
    code: WorkspaceInfrastructureErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.code = code;
  }

  public static configMissing(rootPath: string): WorkspaceInfrastructureError {
    return new WorkspaceInfrastructureError(
      "workspace.config-missing",
      `no .recall/config.json found at the expected location under "${rootPath}"`,
    );
  }

  public static configMalformed(
    rootPath: string,
    detail: string,
  ): WorkspaceInfrastructureError {
    return new WorkspaceInfrastructureError(
      "workspace.config-malformed",
      `failed to parse .recall/config.json under "${rootPath}": ${detail}`,
    );
  }

  public static configReadFailed(
    rootPath: string,
    cause: unknown,
  ): WorkspaceInfrastructureError {
    return new WorkspaceInfrastructureError(
      "workspace.config-read-failed",
      `failed to read .recall/config.json under "${rootPath}"`,
      cause,
    );
  }

  public static configWriteFailed(
    rootPath: string,
    cause: unknown,
  ): WorkspaceInfrastructureError {
    return new WorkspaceInfrastructureError(
      "workspace.config-write-failed",
      `failed to write .recall/config.json under "${rootPath}"`,
      cause,
    );
  }

  public static directoryCreateFailed(
    rootPath: string,
    cause: unknown,
  ): WorkspaceInfrastructureError {
    return new WorkspaceInfrastructureError(
      "workspace.directory-create-failed",
      `failed to create .recall/ under "${rootPath}"`,
      cause,
    );
  }

  public static directoryRemoveFailed(
    rootPath: string,
    cause: unknown,
  ): WorkspaceInfrastructureError {
    return new WorkspaceInfrastructureError(
      "workspace.directory-remove-failed",
      `failed to remove .recall/ under "${rootPath}"`,
      cause,
    );
  }

  public static gitignoreUpdateFailed(
    rootPath: string,
    cause: unknown,
  ): WorkspaceInfrastructureError {
    return new WorkspaceInfrastructureError(
      "workspace.gitignore-update-failed",
      `failed to update .gitignore under "${rootPath}"`,
      cause,
    );
  }

  public static detectionFailed(
    startPath: string,
    cause: unknown,
  ): WorkspaceInfrastructureError {
    return new WorkspaceInfrastructureError(
      "workspace.detection-failed",
      `failed to detect a workspace upward from "${startPath}"`,
      cause,
    );
  }

  public static unlockTargetMissing(
    rootPath: string,
  ): WorkspaceInfrastructureError {
    return new WorkspaceInfrastructureError(
      "workspace.unlock-target-missing",
      `cannot unlock: no workspace found at or above "${rootPath}"`,
    );
  }
}
