import type { Clock } from "../../../../shared/application/ports/clock.port.ts";
import type { EventPublisher } from "../../../../shared/application/ports/event-publisher.port.ts";
import type { IdGenerator } from "../../../../shared/application/ports/id-generator.port.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import { Session } from "../../domain/aggregates/session.ts";
import type { SessionRepository } from "../../domain/repositories/session-repository.ts";
import { SessionId } from "../../domain/value-objects/session-id.ts";
import { SessionIntent } from "../../domain/value-objects/session-intent.ts";

/**
 * Outcome of a `SessionContextHelper.acquire(...)` call.
 */
export interface AcquiredSession {
  readonly session: Session;
  /**
   * `true` when the helper had to start a new session (either because
   * none existed, or because the previous one was idle and got
   * rotated). The caller can surface this in the use-case result
   * (e.g. `RecordTurnUseCase` reports the new session id).
   */
  readonly opened: boolean;
}

/**
 * Internal helper that materialises the implicit-session policy
 * documented in `docs/01-arquitectura.md` §2.5:
 *
 * > "Si pasaron > 30 min sin tool calls: la sesion anterior se cierra
 * >  automaticamente y empieza una nueva."
 *
 * Lives in `application/use-cases/` (NOT in `application/ports/in`)
 * because it is an internal collaborator, not a use case the
 * outside world calls. Several use cases (`RecordTurn`,
 * `RecordDecision`, `TrackTask.create`, ...) consume it to attach the
 * write to the right session id.
 *
 * The helper is NOT a public port: it is a class wired by the
 * composition root once and injected into the use cases that need it.
 * The composition root does the wiring; tests substitute by injecting
 * a stub `SessionRepository` + a fake `Clock`.
 *
 * Side effects (every `acquire` call):
 * - When the active session is idle: ends it, persists the changes,
 *   publishes the `SessionEnded` event.
 * - When no session exists OR the active one was just ended: starts a
 *   fresh one, persists it, publishes `SessionStarted`.
 *
 * Error semantics:
 * - The helper does NOT throw `MemoryApplicationError.noActiveSession`
 *   on the no-session-yet path: it CREATES the session. Callers that
 *   want strict semantics ("there must already be a session") use
 *   {@link SessionContextHelper.findActive} instead.
 */
export class SessionContextHelper {
  public constructor(
    private readonly sessions: SessionRepository,
    private readonly clock: Clock,
    private readonly idGen: IdGenerator,
    private readonly events: EventPublisher,
  ) {}

  /**
   * Returns the active session for `workspaceId`, opening a new one
   * if necessary (and ending the previous one on idle timeout).
   */
  public async acquire(input: {
    workspaceId: WorkspaceId;
    intent: string | null;
  }): Promise<AcquiredSession> {
    const now = this.clock.now();
    const current = await this.sessions.findCurrentByWorkspace(
      input.workspaceId,
    );
    if (current !== null && !current.isIdle(now)) {
      return { session: current, opened: false };
    }
    if (current !== null) {
      // Idle: rotate.
      current.end({ occurredAt: now });
      await this.sessions.save(current);
      await this.events.publishAll(current.pullEvents());
    }
    const fresh = Session.start({
      id: SessionId.from(this.idGen.generateString()),
      workspaceId: input.workspaceId,
      startedAt: now,
      intent: null,
      resumedFrom: current === null ? null : current.getId(),
    });
    if (input.intent !== null && input.intent.trim().length > 0) {
      fresh.setIntent({
        intent: SessionIntent.from(input.intent),
        occurredAt: now,
      });
    }
    await this.sessions.save(fresh);
    await this.events.publishAll(fresh.pullEvents());
    return { session: fresh, opened: true };
  }

  /**
   * Returns the active session for `workspaceId`, or `null` when no
   * open session exists. Does NOT rotate or open. Callers that want
   * implicit rotation use {@link acquire}.
   */
  public async findActive(workspaceId: WorkspaceId): Promise<Session | null> {
    return this.sessions.findCurrentByWorkspace(workspaceId);
  }
}
