import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import { WorkspaceDomainError } from "./workspace-domain-error.ts";

/**
 * Raised when an `initialize` operation is attempted on a path that
 * already hosts a workspace.
 *
 * Per `docs/11-seguridad-modos.md` §§2-4 and `docs/01-arquitectura.md`
 * §2.2, the runtime auto-detects an existing `.mcp-memoria/` and reuses
 * its `workspace_id`. Explicit re-initialization is therefore an error:
 * the user almost certainly wants to either (a) rehydrate the existing
 * workspace or (b) delete the directory first.
 *
 * Invariants:
 * - `code` is the stable identifier `workspace.already-initialized`.
 * - `existingWorkspaceId` exposes the id the runtime found so the
 *   adapter can echo it in error data (the user can then decide whether
 *   to keep it or wipe it explicitly).
 * - `jsonRpcCode` is `null`: there is no project-specific code reserved
 *   for "workspace already initialized" in
 *   `docs/02-protocolo-mcp.md` §6 / `docs/11-seguridad-modos.md` §8.
 *   Adapters typically map this to the standard `INVALID_PARAMS`
 *   (-32602) or surface `code` directly in `error.data.domain_code`.
 */
export class WorkspaceAlreadyInitializedError extends WorkspaceDomainError {
  public readonly code = "workspace.already-initialized";
  public readonly jsonRpcCode: number | null = null;
  public readonly existingWorkspaceId: WorkspaceId;

  public constructor(
    existingWorkspaceId: WorkspaceId,
    options?: { cause?: unknown },
  ) {
    super(
      `workspace ${existingWorkspaceId.toString()} is already initialized; re-initialization is not allowed`,
      options !== undefined ? { cause: options.cause } : undefined,
    );
    this.existingWorkspaceId = existingWorkspaceId;
  }
}
