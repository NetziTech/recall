import { JsonRpcErrorCodes } from "../../../../shared/domain/errors/json-rpc-error-codes.ts";
import type { SessionId } from "../value-objects/session-id.ts";
import { MemoryDomainError } from "./memory-domain-error.ts";

/**
 * Raised when an attempt is made to record activity into a `Session`
 * whose idle-timeout window has elapsed.
 *
 * Per `docs/01-arquitectura.md` §2.5, sessions auto-close after 30
 * minutes (configurable via
 * `~/.config/recall/config.json → session_idle_timeout_min`,
 * `docs/03-modelo-datos.md` §3). The aggregate refuses to extend a
 * session past its idle window: the application layer must end the
 * stale session and start a fresh one. The wire-level mapping is
 * `-32101 SESSION_EXPIRED`, advertised so adapters can surface the
 * documented client behaviour (silent retry that triggers the runtime
 * to auto-create the new session).
 *
 * Invariants:
 * - `code` is the stable identifier `memory.session-idle-timeout-exceeded`.
 * - `sessionId` identifies the stale session.
 * - `idleMillis` is the elapsed milliseconds since the last activity.
 * - `idleTimeoutMillis` is the configured threshold.
 * - `jsonRpcCode` is `JsonRpcErrorCodes.SESSION_EXPIRED` (-32101).
 */
export class SessionIdleTimeoutExceededError extends MemoryDomainError {
  public readonly code = "memory.session-idle-timeout-exceeded";
  public readonly jsonRpcCode: number | null = JsonRpcErrorCodes.SESSION_EXPIRED;
  public readonly sessionId: SessionId;
  public readonly idleMillis: number;
  public readonly idleTimeoutMillis: number;

  public constructor(input: {
    sessionId: SessionId;
    idleMillis: number;
    idleTimeoutMillis: number;
    cause?: unknown;
  }) {
    super(
      `session ${input.sessionId.toString()} exceeded its idle timeout (idle: ${String(input.idleMillis)}ms, threshold: ${String(input.idleTimeoutMillis)}ms)`,
      input.cause !== undefined ? { cause: input.cause } : undefined,
    );
    this.sessionId = input.sessionId;
    this.idleMillis = input.idleMillis;
    this.idleTimeoutMillis = input.idleTimeoutMillis;
  }
}
