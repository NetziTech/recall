import { JsonRpcErrorCodes } from "../../../../shared/domain/errors/json-rpc-error-codes.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import { WorkspaceDomainError } from "./workspace-domain-error.ts";

/**
 * Raised when an operation that requires the encryption key to be
 * available is attempted on a workspace whose mode is `encrypted` but
 * that has not been unlocked in the current process.
 *
 * The contract for the wire-level error is documented in
 * `docs/11-seguridad-modos.md` §3 ("Que pasa cuando otro dev hace
 * git pull") and `docs/11-seguridad-modos.md` §8: the JSON-RPC code is
 * `-32107 ENCRYPTED_LOCKED`.
 *
 * Invariants:
 * - `code` is the stable identifier `workspace.locked`.
 * - `workspaceId` identifies the workspace that needs unlocking, so the
 *   adapter can echo it in `error.data.workspace_id` (matching the
 *   shape in `docs/11-seguridad-modos.md` §3).
 * - `jsonRpcCode` is the canonical `ENCRYPTED_LOCKED` code so the MCP
 *   transport layer can route directly without re-mapping.
 */
export class WorkspaceLockedError extends WorkspaceDomainError {
  public readonly code = "workspace.locked";
  public readonly workspaceId: WorkspaceId;
  public readonly jsonRpcCode: number | null = JsonRpcErrorCodes.ENCRYPTED_LOCKED;

  public constructor(workspaceId: WorkspaceId, options?: { cause?: unknown }) {
    super(
      `workspace ${workspaceId.toString()} is encrypted and locked; an unlock step is required before performing this operation`,
      options !== undefined ? { cause: options.cause } : undefined,
    );
    this.workspaceId = workspaceId;
  }
}
