import type { DomainEvent } from "../../../../shared/domain/types/domain-event.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { SessionId } from "../value-objects/session-id.ts";
import type { SessionNextSeed } from "../value-objects/session-next-seed.ts";
import type { SessionSummary } from "../value-objects/session-summary.ts";
import type { TurnsCount } from "../value-objects/turns-count.ts";

/**
 * Fact: a `Session` was ended.
 *
 * Emitted by `Session.end(...)` either explicitly (the client called
 * `mem.session_force({ action: "end" })`) or implicitly when the
 * runtime detected idle timeout (`docs/01-arquitectura.md` §2.5). The
 * curator subscribes to compute the rolling summary documented in
 * §2.5.
 *
 * The payload carries the final values of the rolling fields
 * (`summary`, `nextSeed`, `turnsCount`) so subscribers do not need to
 * round-trip back to the repository to render the closure (the recall
 * Capa 7 implementation in particular reads `summary` and `nextSeed`
 * to seed the next bundle, `docs/04-capas-contexto.md` §3.7).
 *
 * Invariants:
 * - `eventName` is the stable `"memory.session-ended"` identifier.
 * - `summary` and `nextSeed` are nullable: a session can close without
 *   the curator having had time to summarise it (e.g. an explicit
 *   immediate close).
 * - `turnsCount` reflects the final count.
 */
export class SessionEnded implements DomainEvent {
  public readonly eventName = "memory.session-ended" as const;
  public readonly occurredAt: Timestamp;
  public readonly workspaceId: WorkspaceId;
  public readonly sessionId: SessionId;
  public readonly summary: SessionSummary | null;
  public readonly nextSeed: SessionNextSeed | null;
  public readonly turnsCount: TurnsCount;

  public constructor(input: {
    workspaceId: WorkspaceId;
    sessionId: SessionId;
    summary: SessionSummary | null;
    nextSeed: SessionNextSeed | null;
    turnsCount: TurnsCount;
    occurredAt: Timestamp;
  }) {
    this.workspaceId = input.workspaceId;
    this.sessionId = input.sessionId;
    this.summary = input.summary;
    this.nextSeed = input.nextSeed;
    this.turnsCount = input.turnsCount;
    this.occurredAt = input.occurredAt;
  }
}
