import { DomainError } from "../../../../shared/domain/errors/domain-error.ts";

/**
 * Base class for application-tier errors raised by the workspace
 * use cases.
 *
 * Why these are NOT in `domain/errors/`:
 *   - They describe *application preconditions* (e.g. "the user
 *     pointed at a path with no workspace") rather than domain
 *     invariant violations. The domain has no opinion on whether a
 *     workspace should exist at a given filesystem location.
 *
 * Why these are NOT in `infrastructure/errors/`:
 *   - The use case raises them based on `findById` returning null /
 *     a detector reporting "no workspace". No filesystem failure
 *     happened — the answer was just "absent". Surfacing them as
 *     `InfrastructureError` would falsely signal an operational
 *     glitch.
 *
 * Bridging the two: we still extend `DomainError` so the cross-cutting
 * adapter (CLI / MCP transport) that surveys typed errors uniformly
 * keeps a single contract. The `code` is in the `workspace.app.*`
 * namespace to disambiguate from genuinely-domain errors
 * (`workspace.locked`, `workspace.invalid-mode-transition`, ...).
 */
export abstract class WorkspaceApplicationError extends DomainError {
  protected constructor(message: string, options?: { cause?: unknown }) {
    super(
      message,
      options !== undefined ? { cause: options.cause } : undefined,
    );
  }
}

/**
 * Raised when an operation that requires an existing workspace is
 * invoked on a path where none is found. The CLI maps this to the
 * `invalidConfig` exit code (`docs/07-instalacion.md`).
 */
export class NoWorkspaceAtPathError extends WorkspaceApplicationError {
  public readonly code = "workspace.app.no-workspace-at-path";
  public readonly rootPath: string;

  public constructor(rootPath: string, options?: { cause?: unknown }) {
    super(
      `no workspace found at or above "${rootPath}"; run "recall init" first`,
      options !== undefined ? { cause: options.cause } : undefined,
    );
    this.rootPath = rootPath;
  }
}
