import type { DomainEvent } from "../../../../shared/domain/types/domain-event.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { OpenQuestionText } from "../value-objects/open-question.ts";
import type { SessionId } from "../value-objects/session-id.ts";

/**
 * Fact: an open question was added to the session's metadata.
 *
 * Emitted by `Session.addOpenQuestion(...)`. Subscribers can use this
 * to drive Capa 7 (Open Questions) of the context bundle
 * (`docs/04-capas-contexto.md` §3.7) and to surface the question in
 * the next session's bundle so the user can answer or close it.
 *
 * Invariants:
 * - `eventName` is the stable
 *   `"memory.session-open-question-added"` identifier.
 * - `text` carries the question body as recorded in the session
 *   metadata.
 */
export class SessionOpenQuestionAdded implements DomainEvent {
  public readonly eventName = "memory.session-open-question-added" as const;
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
