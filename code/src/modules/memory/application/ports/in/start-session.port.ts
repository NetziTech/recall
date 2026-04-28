import type { WorkspaceId } from "../../../../../shared/domain/value-objects/workspace-id.ts";
import type { SessionId } from "../../../domain/value-objects/session-id.ts";

/**
 * Result of a `StartSession.start(...)` invocation.
 */
export interface StartSessionResult {
  readonly sessionId: SessionId;
  /**
   * `true` when the call closed an idle session before opening the
   * new one. The CLI's `mem session_force` surfaces this so the
   * operator knows what happened.
   */
  readonly previousSessionClosed: boolean;
}

/**
 * Driving (input) port: open a new session (or roll the active one
 * over).
 *
 * Most call sites do NOT call this directly: `RecordTurn`,
 * `RecordDecision`, `TrackTask.create` invoke it implicitly via the
 * shared session helper to honour the `30 min idle → rotate` rule
 * (`docs/01-arquitectura.md` §2.5). The dedicated port exists so the
 * CLI's `mem session_force` (and its MCP equivalent) can rotate
 * eagerly without piggybacking on a write.
 *
 * Behaviour:
 * - When an active session exists and is NOT idle, the use case
 *   refuses to start a new one (returns the active id with
 *   `previousSessionClosed = false`). This keeps the "one open
 *   session per workspace" invariant.
 * - When an active session exists and IS idle, the use case ends
 *   it first, then opens a new one (`previousSessionClosed = true`).
 * - When no session exists, the use case opens a fresh one.
 */
export interface StartSession {
  start(input: {
    workspaceId: WorkspaceId;
    intent: string | null;
  }): Promise<StartSessionResult>;
}
