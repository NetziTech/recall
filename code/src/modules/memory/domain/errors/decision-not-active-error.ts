import type { DecisionId } from "../value-objects/decision-id.ts";
import { MemoryDomainError } from "./memory-domain-error.ts";

/**
 * Raised when the application layer attempts to supersede a
 * `Decision` whose status is already `superseded`.
 *
 * Per `docs/03-modelo-datos.md` §4.3, decisions never get deleted —
 * they only get superseded. Once that bit is set, a second
 * supersedeship would either lose history (which decision wins?) or
 * silently no-op (which masks bugs). The aggregate refuses both,
 * pushing the caller to either record a fresh decision that
 * supersedes the *current* leader, or leave the chain alone.
 *
 * Invariants:
 * - `code` is the stable identifier `memory.decision-not-active`.
 * - `decisionId` identifies the offending decision so adapters can
 *   echo it in error data.
 * - `jsonRpcCode` is `null`: the protocol catalog
 *   (`docs/02-protocolo-mcp.md` §6) does not allocate a code for
 *   "decision already superseded". Adapters typically map this to
 *   `INVALID_PARAMS`.
 */
export class DecisionNotActiveError extends MemoryDomainError {
  public readonly code = "memory.decision-not-active";
  public readonly jsonRpcCode: number | null = null;
  public readonly decisionId: DecisionId;

  public constructor(decisionId: DecisionId, cause?: unknown) {
    super(
      `decision ${decisionId.toString()} is not active and cannot be superseded again`,
      cause,
    );
    this.decisionId = decisionId;
  }
}
