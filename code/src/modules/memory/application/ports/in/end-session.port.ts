import type { WorkspaceId } from "../../../../../shared/domain/value-objects/workspace-id.ts";
import type { SessionId } from "../../../domain/value-objects/session-id.ts";

/**
 * Result of an `EndSession.end(...)` invocation.
 */
export interface EndSessionResult {
  /**
   * Id of the session that was closed, or `null` when no active
   * session existed at the time of the call (the operation is a
   * no-op).
   */
  readonly sessionId: SessionId | null;
}

/**
 * Driving (input) port: close the active session (without rolling a
 * new one).
 *
 * The CLI's `mem session_close` and the curator's
 * `RollupSessionUseCase` both rely on this primitive. The use case
 * does NOT generate the rollup summary — the curator owns that
 * responsibility (`docs/05-memoria-decay.md` §7). This use case
 * simply marks the session as ended and emits `SessionEnded`; the
 * curator subscribes to that event to schedule the rollup.
 */
export interface EndSession {
  end(input: { workspaceId: WorkspaceId }): Promise<EndSessionResult>;
}
