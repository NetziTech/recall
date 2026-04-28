import type { WorkspaceId } from "../../../../../shared/domain/value-objects/workspace-id.ts";

/**
 * Outcome of one `RollupSession` invocation.
 *
 * - `sessionsClosed`: how many idle sessions the rollup just ended
 *   (the `Session.end(...)` aggregate transition). Zero is the common
 *   case when the curator runs while the user is active.
 * - `summariesGenerated`: how many of the closed sessions received a
 *   freshly-authored summary. A session may end without a summary if
 *   it had no recorded turns (the rollup skips summary generation
 *   when there is nothing to summarise).
 * - `learningsCreated`: rolled-up sessions can convert into a
 *   long-lived `Learning` (per `docs/05-memoria-decay.md` §7 — the
 *   summary lives in the session aggregate, but a successor learning
 *   can capture the highest-signal points so they survive past the
 *   session's eventual decay). The use case keeps this count at zero
 *   in the MVP and may grow later; the field is in the result DTO so
 *   callers do not need to refactor when it does.
 */
export interface RollupSessionResult {
  readonly sessionsClosed: number;
  readonly summariesGenerated: number;
  readonly learningsCreated: number;
}

/**
 * Driving (input) port: roll up sessions whose idle window has
 * expired.
 *
 * Mirrors the session-rollup behaviour documented in
 * `docs/05-memoria-decay.md` §7 ("Sesion-rollup automatico") and the
 * underlying state machine in
 * `modules/memory/domain/aggregates/session.ts`. The use case:
 *
 * 1. Asks the `SessionRepository` driven port (cross-import to
 *    `memory/domain` authorised by ADR-001) for the active session
 *    of the workspace.
 * 2. If the session exists AND its idle window is past
 *    (`Session.isIdle(now) === true`), it:
 *      a. Generates a summary by concatenating the top-N turn
 *         summaries by confidence (the underlying enumeration is
 *         delegated to the adapter; the use case stays free of SQL).
 *      b. Calls `Session.setSummary(...)` and `Session.end(...)` on
 *         the aggregate, persists it, and drains its events.
 *
 * Idempotency:
 * - The use case is naturally idempotent: a session that was already
 *   closed on a previous invocation is filtered out by
 *   `findCurrentByWorkspace(...)` returning `null`. Calling rollup
 *   twice within the same idle window therefore produces a no-op on
 *   the second call.
 *
 * Concurrency:
 * - The use case MUST NOT run concurrently with `mem.remember` /
 *   `mem.recall` for the same workspace: closing a session under a
 *   live tool call would let `Session.recordActivity(...)` raise
 *   `SessionAlreadyEndedError`. The orchestrator runs rollup at
 *   `session_close` triggers (idle timer fired) or in the slow
 *   nightly pass; both windows are quiescent for the workspace.
 *
 * Trigger relationship:
 * - When `RunFullPassUseCase` is started with a `session_close`
 *   trigger, this use case runs FIRST (the rollup creates the events
 *   the rest of the pass folds into the run stats).
 */
export interface RollupSession {
  rollup(input: {
    workspaceId: WorkspaceId;
  }): Promise<RollupSessionResult>;
}
