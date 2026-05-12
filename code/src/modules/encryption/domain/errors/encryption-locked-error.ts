import { JsonRpcErrorCodes } from "../../../../shared/domain/errors/json-rpc-error-codes.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import { EncryptionDomainError } from "./encryption-domain-error.ts";

/**
 * Raised when an operation that requires the encryption aggregate to
 * be currently unlocked (`EncryptionConfig.isUnlocked() === true`)
 * is attempted on a locked aggregate.
 *
 * Distinct from {@link import("./encryption-not-initialized-error.ts").EncryptionNotInitializedError}
 * (encryption config simply does not exist) and from
 * {@link import("./key-validation-failed-error.ts").KeyValidationFailedError}
 * (a passphrase was tried and rejected). This error signals that the
 * aggregate exists, is correctly initialized, but no master key is
 * currently resident in the process. The caller's next move is
 * typically to invoke the unlock flow (CLI: `recall unlock`; MCP:
 * `mem.unlock`).
 *
 * Why this lives in the `encryption` module (and not borrowed from
 * `workspace`):
 * - The `workspace` module owns its own `WorkspaceLockedError` for
 *   workspace-level lock semantics ("the workspace aggregate
 *   refuses to act because its encryption sibling is locked").
 *   The encryption module needs its own variant so a domain-level
 *   `instanceof EncryptionDomainError` check covers every failure
 *   mode the module can emit. Mirrors the rule the architect
 *   enforces in `scripts/validate-modules.ts`: each module owns
 *   the errors it raises; cross-module error reuse is forbidden by
 *   ADR-001 (HANDOFF.md §6.6).
 *
 * Wire mapping:
 * - `jsonRpcCode` is `ENCRYPTED_LOCKED` (`-32107`), matching the
 *   wire contract documented in `docs/11-seguridad-modos.md` §3 /
 *   `docs/02-protocolo-mcp.md` §6. The CLI / MCP transport layers
 *   pass the code through unchanged so clients can branch on the
 *   single canonical "encryption is locked" code regardless of the
 *   module that raised the error.
 *
 * Invariants:
 * - `code` is the stable identifier `encryption.locked`.
 * - `workspaceId` identifies the offending workspace; serialised by
 *   the transport into `error.data.workspace_id`.
 * - The message MUST NOT include passphrase or key material.
 */
export class EncryptionLockedError extends EncryptionDomainError {
  public readonly code = "encryption.locked";
  public readonly jsonRpcCode: number | null = JsonRpcErrorCodes.ENCRYPTED_LOCKED;
  public readonly workspaceId: WorkspaceId;

  public constructor(workspaceId: WorkspaceId, cause?: unknown) {
    super(
      `encryption config for workspace ${workspaceId.toString()} is locked; an unlock step is required before performing this operation`,
      cause,
    );
    this.workspaceId = workspaceId;
  }
}
