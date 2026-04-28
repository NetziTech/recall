import type { Clock } from "../../../../shared/application/ports/clock.port.ts";
import type { EventPublisher } from "../../../../shared/application/ports/event-publisher.port.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { SessionRepository } from "../../domain/repositories/session-repository.ts";
import type {
  EndSession,
  EndSessionResult,
} from "../ports/in/end-session.port.ts";

/**
 * Use case: close the active session of a workspace.
 *
 * Implements the `EndSession` driving port. The use case does NOT
 * generate the rollup summary — the curator owns that
 * (`docs/05-memoria-decay.md` §7). This use case simply marks the
 * session as ended and emits `SessionEnded`; the curator subscribes
 * to that event to schedule the rollup pass.
 *
 * No-op semantics:
 * - When no active session exists, the use case returns
 *   `{ sessionId: null }` and emits no event.
 */
export class EndSessionUseCase implements EndSession {
  public constructor(
    private readonly sessions: SessionRepository,
    private readonly clock: Clock,
    private readonly events: EventPublisher,
  ) {}

  public async end(input: {
    workspaceId: WorkspaceId;
  }): Promise<EndSessionResult> {
    const session = await this.sessions.findCurrentByWorkspace(
      input.workspaceId,
    );
    if (session === null) {
      return { sessionId: null };
    }
    session.end({ occurredAt: this.clock.now() });
    await this.sessions.save(session);
    await this.events.publishAll(session.pullEvents());
    return { sessionId: session.getId() };
  }
}
