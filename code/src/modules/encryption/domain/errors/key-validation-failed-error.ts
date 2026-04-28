import { JsonRpcErrorCodes } from "../../../../shared/domain/errors/json-rpc-error-codes.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import { EncryptionDomainError } from "./encryption-domain-error.ts";

/**
 * Raised when a candidate `MasterKey` fails to decrypt the
 * `KeyValidatorBlob` of a workspace.
 *
 * Mapped to `-32108 INVALID_KEY` on the wire, per the catalog in
 * `docs/02-protocolo-mcp.md` §6 and the unlock flow described in
 * `docs/11-seguridad-modos.md` §7 ("Validacion de clave"). The CLI
 * surfaces this as "la clave no abre la DB; verifica que sea la
 * correcta".
 *
 * Security invariants (NON-NEGOTIABLE):
 * - The error message MUST NOT include the candidate key bytes, the
 *   passphrase, the derived key or any byte that could narrow the
 *   keyspace for an attacker observing logs.
 * - The only contextual data carried by the error is the
 *   `workspaceId`, which is already public (it sits in
 *   `config.json` of the repo and gets echoed in JSON-RPC error
 *   data per `docs/11-seguridad-modos.md` §3).
 *
 * Invariants:
 * - `code` is the stable identifier `encryption.key-validation-failed`.
 * - `jsonRpcCode` is `INVALID_KEY` (-32108).
 */
export class KeyValidationFailedError extends EncryptionDomainError {
  public readonly code = "encryption.key-validation-failed";
  public readonly jsonRpcCode: number | null = JsonRpcErrorCodes.INVALID_KEY;
  public readonly workspaceId: WorkspaceId;

  public constructor(workspaceId: WorkspaceId, options?: { cause?: unknown }) {
    super(
      `key validation failed for workspace ${workspaceId.toString()}: the candidate key does not match the workspace validator`,
      options !== undefined ? { cause: options.cause } : undefined,
    );
    this.workspaceId = workspaceId;
  }
}
