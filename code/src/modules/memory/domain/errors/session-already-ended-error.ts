import type { SessionId } from "../value-objects/session-id.ts";
import { MemoryDomainError } from "./memory-domain-error.ts";

/**
 * Raised when an operation that requires an open `Session` is
 * attempted on one that has already been ended.
 *
 * Sessions are append-only event groupings (`docs/01-arquitectura.md`
 * §2.5): once `ended_at_ms` is set, no further activity can be
 * recorded and the aggregate is read-only. The application layer is
 * responsible for starting a fresh session if the user resumes work
 * after a session has been ended (either explicitly via
 * `mem.session_force` or implicitly via the 30-minute idle timeout).
 *
 * Invariants:
 * - `code` is the stable identifier `memory.session-already-ended`.
 * - `sessionId` identifies the offending session.
 * - `jsonRpcCode` is `null`. The protocol catalog reserves
 *   `-32101 SESSION_EXPIRED` for the *idle-timeout* case (the runtime
 *   auto-recovers); this error is for *deliberate* attempts to write
 *   into a closed session, which is a contract bug, not a recoverable
 *   condition.
 */
export class SessionAlreadyEndedError extends MemoryDomainError {
  public readonly code = "memory.session-already-ended";
  public readonly jsonRpcCode: number | null = null;
  public readonly sessionId: SessionId;

  public constructor(sessionId: SessionId, cause?: unknown) {
    super(
      `session ${sessionId.toString()} has already ended and cannot accept further activity`,
      cause,
    );
    this.sessionId = sessionId;
  }
}
