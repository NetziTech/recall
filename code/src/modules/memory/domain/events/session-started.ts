import type { DomainEvent } from "../../../../shared/domain/types/domain-event.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { SessionId } from "../value-objects/session-id.ts";
import type { SessionIntent } from "../value-objects/session-intent.ts";

/**
 * Fact: a `Session` was started.
 *
 * Emitted by `Session.start(...)` either explicitly (the client called
 * `mem.session_force({ action: "start" })`) or implicitly when the
 * runtime detected idle timeout and auto-rotated
 * (`docs/01-arquitectura.md` §2.5).
 *
 * The payload carries the optional `intent` (so subscribers can
 * render Capa 1 — System Identity — without an extra repository
 * lookup, `docs/04-capas-contexto.md` §3.1) and the optional
 * `resumedFrom` link (when the new session continues a previous
 * session's `next_seed`, per `docs/03-modelo-datos.md` §4.1).
 *
 * Invariants:
 * - `eventName` is the stable `"memory.session-started"` identifier.
 * - `intent` and `resumedFrom` are nullable to model the unset case.
 */
export class SessionStarted implements DomainEvent {
  public readonly eventName = "memory.session-started" as const;
  public readonly occurredAt: Timestamp;
  public readonly workspaceId: WorkspaceId;
  public readonly sessionId: SessionId;
  public readonly intent: SessionIntent | null;
  public readonly resumedFrom: SessionId | null;

  public constructor(input: {
    workspaceId: WorkspaceId;
    sessionId: SessionId;
    intent: SessionIntent | null;
    resumedFrom: SessionId | null;
    occurredAt: Timestamp;
  }) {
    this.workspaceId = input.workspaceId;
    this.sessionId = input.sessionId;
    this.intent = input.intent;
    this.resumedFrom = input.resumedFrom;
    this.occurredAt = input.occurredAt;
  }
}
