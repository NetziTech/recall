import type { DomainEvent } from "../../../../shared/domain/types/domain-event.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { SessionId } from "../value-objects/session-id.ts";
import type { TurnId } from "../value-objects/turn-id.ts";

/**
 * Fact: a `Turn` was surfaced (recall hit, included in a context
 * bundle, ...).
 *
 * Emitted by `Turn.markUsed(...)`. Subscribers can use this to drive
 * telemetry on which historical turns the assistant relies on. The
 * curator's decay pass and the recall scorer both read the resulting
 * `useCount` / `lastUsed` to rank Capa 4 (Recent Turns,
 * `docs/04-capas-contexto.md` §3.4).
 *
 * Invariants:
 * - `eventName` is the stable `"memory.turn-used"` identifier.
 */
export class TurnUsed implements DomainEvent {
  public readonly eventName = "memory.turn-used" as const;
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
