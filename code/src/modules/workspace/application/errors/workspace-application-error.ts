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
 *
 * Path/identifier redaction (W-3.5-SEC-L2, mirrors PR #45):
 * - Absolute filesystem paths attached to these errors live in the
 *   structured {@link WorkspaceApplicationError.details} bag, NOT in
 *   `message`. Pino's `DEFAULT_REDACT_PATHS` covers `details.path`
 *   and `*.details.path` so the value is redacted whenever the error
 *   travels through the logger. The JSON-RPC wire mapper only
 *   surfaces `message` to clients, so the same convention prevents
 *   leaks across that boundary too.
 */
export type WorkspaceApplicationErrorDetails = Readonly<Record<string, unknown>>;

export abstract class WorkspaceApplicationError extends DomainError {
  /**
   * Structured fields that supplement {@link Error.message} without
   * appearing inside the message string. Always defined (empty object
   * when the subclass has nothing to attach) so callers can dot-access
   * `details.path` without an undefined-guard.
   */
  public readonly details: WorkspaceApplicationErrorDetails;

  protected constructor(
    message: string,
    details: WorkspaceApplicationErrorDetails,
    cause?: unknown,
  ) {
    super(message, cause);
    this.details = details;
  }
}

/**
 * Raised when an operation that requires an existing workspace is
 * invoked on a path where none is found. The CLI maps this to the
 * `invalidConfig` exit code (`docs/07-instalacion.md`).
 *
 * The requested filesystem path lives in `details.path` (not in
 * `message`) so pino redacts it when logged and the JSON-RPC wire
 * payload does not leak it to remote MCP clients.
 */
export class NoWorkspaceAtPathError extends WorkspaceApplicationError {
  public readonly code = "workspace.app.no-workspace-at-path";

  public constructor(rootPath: string, cause?: unknown) {
    super(
      'no workspace found at or above the requested path; run "recall init" first',
      { path: rootPath },
      cause,
    );
  }
}
