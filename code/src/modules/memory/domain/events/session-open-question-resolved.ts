import type { DomainEvent } from "../../../../shared/domain/types/domain-event.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { OpenQuestionText } from "../value-objects/open-question.ts";
import type { SessionId } from "../value-objects/session-id.ts";

/**
 * Fact: an open question was resolved (removed from the session
 * metadata).
 *
 * Emitted by `Session.resolveOpenQuestion(...)` when the user answers
 * a question or the curator decides to drop it (e.g. a decision with
 * tag `answers:<question_id>` was recorded —
 * `docs/04-capas-contexto.md` §3.7 — "preguntas se 'olvidan' cuando
 * alguna decision con tag `answers:<question_id>` se registra").
 *
 * Invariants:
 * - `eventName` is the stable
 *   `"memory.session-open-question-resolved"` identifier.
 * - `text` carries the resolved question body so subscribers can
 *   correlate without a separate id lookup.
 */
export class SessionOpenQuestionResolved implements DomainEvent {
  public readonly eventName = "memory.session-open-question-resolved" as const;
  public readonly occurredAt: Timestamp;
  public readonly workspaceId: WorkspaceId;
  public readonly sessionId: SessionId;
  public readonly text: OpenQuestionText;

  public constructor(input: {
    workspaceId: WorkspaceId;
    sessionId: SessionId;
    text: OpenQuestionText;
    occurredAt: Timestamp;
  }) {
    this.workspaceId = input.workspaceId;
    this.sessionId = input.sessionId;
    this.text = input.text;
    this.occurredAt = input.occurredAt;
  }
}
