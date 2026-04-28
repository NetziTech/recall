import type { DomainEvent } from "../../../../shared/domain/types/domain-event.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { SessionId } from "../value-objects/session-id.ts";
import type { TurnId } from "../value-objects/turn-id.ts";

/**
 * Fact: a `Turn` was just recorded.
 *
 * Emitted exactly once per `Turn`, by `Turn.record(...)`. The
 * companion `TurnUsed` event covers later recall hits; together they
 * are the only events the aggregate ever emits (the rapid-decay rule
 * for turns described in `docs/04-capas-contexto.md` §3.4 happens
 * silently, without per-turn events, to avoid flooding the bus during
 * curator passes).
 *
 * Invariants:
 * - `sessionId` is the session the turn belongs to.
 * - `eventName` is the stable `"memory.turn-recorded"` identifier.
 */
export class TurnRecorded implements DomainEvent {
  public readonly eventName = "memory.turn-recorded" as const;
  public readonly occurredAt: Timestamp;
  public readonly workspaceId: WorkspaceId;
  public readonly sessionId: SessionId;
  public readonly turnId: TurnId;

  public constructor(input: {
    workspaceId: WorkspaceId;
    sessionId: SessionId;
    turnId: TurnId;
    occurredAt: Timestamp;
  }) {
    this.workspaceId = input.workspaceId;
    this.sessionId = input.sessionId;
    this.turnId = input.turnId;
    this.occurredAt = input.occurredAt;
  }
}
