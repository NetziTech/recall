import type { Tags } from "../../../../../shared/domain/value-objects/tags.ts";
import type { WorkspaceId } from "../../../../../shared/domain/value-objects/workspace-id.ts";
import type { DecisionId } from "../../../domain/value-objects/decision-id.ts";
import type { LearningId } from "../../../domain/value-objects/learning-id.ts";
import type { SessionId } from "../../../domain/value-objects/session-id.ts";
import type { TurnId } from "../../../domain/value-objects/turn-id.ts";

/**
 * Result of a `RecordTurn` invocation.
 */
export interface RecordTurnResult {
  readonly turnId: TurnId;
  readonly sessionId: SessionId;
  readonly embeddingEnqueued: boolean;
}

/**
 * Driving (input) port: append a `Turn` to a workspace's history.
 *
 * Maps to the `kind=turn` arm of `mem.remember`
 * (`docs/02-protocolo-mcp.md` §4.4) and is the central event of the
 * implicit-session model. The use case:
 *
 * 1. Loads (or starts, see {@link RecordTurn} JSDoc on auto-rotate)
 *    the active session for the workspace.
 * 2. Mints a fresh `TurnId`.
 * 3. Builds the `Turn` aggregate (`Turn.record(...)`).
 * 4. Persists it AND bumps the session's activity counters in a
 *    single transaction.
 * 5. Enqueues the embedding job.
 *
 * Auto-rotate semantics:
 * - The `RecordTurnUseCase` consults `Session.isIdle(now)`. When the
 *   active session has timed out (>= 30 min idle, see
 *   `DEFAULT_SESSION_IDLE_TIMEOUT_MS`), the use case calls
 *   `Session.end(...)` on the stale one and `Session.start(...)` on a
 *   fresh one before recording the turn. The new session id is
 *   returned in the result.
 * - When no session exists yet (first turn after `mem.init`), the use
 *   case starts a session implicitly.
 */
export interface RecordTurn {
  record(input: {
    workspaceId: WorkspaceId;
    summary: string;
    intent: string | null;
    outcome: string | null;
    filesTouched: readonly string[];
    linkedDecisions: readonly DecisionId[];
    linkedLearnings: readonly LearningId[];
    tags: Tags;
  }): Promise<RecordTurnResult>;
}
