import type { Tags } from "../../../../../shared/domain/value-objects/tags.ts";
import type { WorkspaceId } from "../../../../../shared/domain/value-objects/workspace-id.ts";
import type { DecisionId } from "../../../domain/value-objects/decision-id.ts";
import type { Scope } from "../../../domain/value-objects/scope.ts";
import type { SessionId } from "../../../domain/value-objects/session-id.ts";

/**
 * Result of a `RecordDecision` invocation.
 */
export interface RecordDecisionResult {
  readonly decisionId: DecisionId;
  /**
   * `true` when the embedder pipeline accepted the new entry; `false`
   * when the enqueue side-effect failed and the entry was persisted
   * without an embedding job (the curator's nightly pass will re-queue
   * it). Mirrors `docs/02-protocolo-mcp.md` §4.4 — `mem.remember`
   * surfaces `embedding_status` = `"queued" | "ready" | "skipped"`.
   */
  readonly embeddingEnqueued: boolean;
}

/**
 * Driving (input) port: record a brand-new architectural `Decision`.
 *
 * Maps to the `kind=decision` arm of `mem.remember`
 * (`docs/02-protocolo-mcp.md` §4.4). The use case orchestrates:
 *
 * 1. Mints a fresh `DecisionId` via the `IdGenerator`.
 * 2. Builds the `Decision` aggregate (`Decision.record(...)`).
 * 3. Persists it via `DecisionRepository.save(...)`.
 * 4. Drains aggregate events and publishes them via
 *    `EventPublisher.publishAll(...)`.
 * 5. Enqueues an embedding job via `EmbeddingEnqueuer.enqueue(...)`.
 *
 * Idempotency:
 * - The use case is NOT idempotent over `(title, rationale)` — duplicate
 *   decisions are accepted at this layer; the curator's consolidation
 *   pass is what folds equivalent entries.
 *
 * Side effects:
 * - One `decisions` row inserted.
 * - One `embedding_queue` row inserted (best-effort).
 * - `DecisionRecorded` event published.
 *
 * Pre-conditions:
 * - The `workspaceId` is well-formed (caller validated).
 * - When `sessionId` is non-null, the application layer has already
 *   verified the session is open (the use case does not re-check; the
 *   `mem.remember` upstream handler is responsible).
 */
export interface RecordDecision {
  record(input: {
    workspaceId: WorkspaceId;
    sessionId: SessionId | null;
    title: string;
    rationale: string;
    /**
     * Long-form body of the decision. Mirrors the wire `content`
     * field (`docs/02 §4.4`) introduced into the `decisions.content`
     * column by migration 008 (B-MCP-4 / issue #3). When absent the
     * use case falls back to `rationale` so the persisted column
     * stays non-empty.
     */
    content?: string;
    tags: Tags;
    scope: Scope;
  }): Promise<RecordDecisionResult>;
}
