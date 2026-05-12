import type { WorkspaceMode } from "../value-objects/workspace-mode.ts";
import { WorkspaceDomainError } from "./workspace-domain-error.ts";

/**
 * Raised when a `Workspace.changeMode(...)` call would move the
 * aggregate through a transition the domain refuses to perform without
 * an intermediate step.
 *
 * The single forbidden direct transition today is
 * `encrypted -> shared`: going from an encrypted workspace to plaintext
 * `shared` requires the operator to first move to `private` (or run an
 * explicit unlock + re-cipher pipeline that lives outside the domain).
 * The reasoning is documented in `docs/11-seguridad-modos.md` §5
 * ("Cambios de modo") under the "Warning" rows: the on-disk history
 * would otherwise contain encrypted entries followed by plaintext
 * entries with no intermediate step the user agreed to.
 *
 * The conservative two-step protocol forces the operator to make an
 * explicit decision (`private` first wipes the share surface and lets
 * the user re-introduce the workspace deliberately). A future iteration
 * can relax this once the application layer has an explicit
 * "decrypt-then-share" use case to call.
 *
 * Invariants:
 * - `code` is the stable identifier `workspace.invalid-mode-transition`.
 * - `from` and `to` are kept as `WorkspaceMode` instances so adapters
 *   can render them with full domain context.
 * - `jsonRpcCode` is `null`: this is a state-machine refusal, not a
 *   schema issue, and the protocol catalog (`docs/02-protocolo-mcp.md`
 *   §6) does not allocate a project-specific code for "illegal mode
 *   transition". Adapters are free to map this error to the standard
 *   JSON-RPC `INVALID_PARAMS` (-32602) or expose `code` directly in
 *   `error.data.domain_code`. We unify the contract via
 *   `WorkspaceDomainError.jsonRpcCode: number | null` so every adapter
 *   can branch uniformly without method-vs-field asymmetry.
 *
 * Consumers that need the canonical JSON-RPC catalog should import
 * `JsonRpcErrorCodes` directly from
 * `shared/domain/errors/json-rpc-error-codes.ts` (this error class
 * deliberately does NOT re-export it: a domain error should not act as
 * a secondary entry-point for the transport-level catalog).
 */
export class InvalidModeTransitionError extends WorkspaceDomainError {
  public readonly code = "workspace.invalid-mode-transition";
  public readonly jsonRpcCode: number | null = null;
  public readonly from: WorkspaceMode;
  public readonly to: WorkspaceMode;

  public constructor(
    from: WorkspaceMode,
    to: WorkspaceMode,
    cause?: unknown,
  ) {
    super(
      `workspace mode transition "${from.toString()}" -> "${to.toString()}" is not allowed; an intermediate step is required`,
      cause,
    );
    this.from = from;
    this.to = to;
  }
}
