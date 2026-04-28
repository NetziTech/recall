import type { SessionId } from "../value-objects/session-id.ts";
import { MemoryDomainError } from "./memory-domain-error.ts";

/**
 * Raised when an attempt to record session activity carries a
 * timestamp older than the session's last known activity.
 *
 * Sessions accumulate activity timestamps monotonically: each new
 * `recordActivity(at)` extends the active window. Allowing
 * out-of-order timestamps would let a stale call resurrect a session
 * the runtime has already auto-closed (`docs/01-arquitectura.md`
 * §2.5) and corrupt the idle-timeout bookkeeping. The aggregate
 * rejects them so the application layer surfaces the bug instead of
 * silently distorting memory.
 *
 * Invariants:
 * - `code` is the stable identifier `memory.non-monotonic-activity`.
 * - `sessionId`, `previousActivityMs`, `attemptedActivityMs` describe
 *   the offending mutation.
 * - `jsonRpcCode` is `null`.
 */
export class NonMonotonicActivityError extends MemoryDomainError {
  public readonly code = "memory.non-monotonic-activity";
  public readonly jsonRpcCode: number | null = null;
  public readonly sessionId: SessionId;
  public readonly previousActivityMs: number;
  public readonly attemptedActivityMs: number;

  public constructor(input: {
    sessionId: SessionId;
    previousActivityMs: number;
    attemptedActivityMs: number;
    cause?: unknown;
  }) {
    super(
      `session ${input.sessionId.toString()} cannot accept activity at ${String(input.attemptedActivityMs)}ms because the latest activity is at ${String(input.previousActivityMs)}ms`,
      input.cause !== undefined ? { cause: input.cause } : undefined,
    );
    this.sessionId = input.sessionId;
    this.previousActivityMs = input.previousActivityMs;
    this.attemptedActivityMs = input.attemptedActivityMs;
  }
}
