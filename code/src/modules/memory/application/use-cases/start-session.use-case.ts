import type { Clock } from "../../../../shared/application/ports/clock.port.ts";
import type { EventPublisher } from "../../../../shared/application/ports/event-publisher.port.ts";
import type { IdGenerator } from "../../../../shared/application/ports/id-generator.port.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import { Session } from "../../domain/aggregates/session.ts";
import type { SessionRepository } from "../../domain/repositories/session-repository.ts";
import { SessionId } from "../../domain/value-objects/session-id.ts";
import { SessionIntent } from "../../domain/value-objects/session-intent.ts";
import type {
  StartSession,
  StartSessionResult,
} from "../ports/in/start-session.port.ts";

/**
 * Use case: open a new session, optionally rotating an idle one.
 *
 * Implements the `StartSession` driving port. The use case is the
 * eager counterpart of `SessionContextHelper.acquire(...)`: callers
 * (the CLI's `mem session_force` and the MCP equivalent) can rotate
 * the session without waiting for a write to trigger the helper.
 *
 * Rules:
 * - When the active session exists and is NOT idle, the use case is a
 *   no-op (returns the existing session id with
 *   `previousSessionClosed: false`). This keeps the "one open
 *   session per workspace" invariant.
 * - When the active session exists and IS idle, the use case ends it
 *   and opens a fresh one (`previousSessionClosed: true`).
 * - When no session exists, the use case opens a fresh one.
 *
 * Implementation note: the duplication with
 * `SessionContextHelper.acquire(...)` is intentional. The helper is
 * an internal utility for write paths; this use case is a public port
 * with its own contract (idempotency on non-idle, explicit
 * `previousSessionClosed` flag). Calling the helper from here would
 * leak the helper's "always rotate when idle" policy as the public
 * contract.
 */
export class StartSessionUseCase implements StartSession {
  public constructor(
    private readonly sessions: SessionRepository,
    private readonly idGen: IdGenerator,
    private readonly clock: Clock,
    private readonly events: EventPublisher,
  ) {}

  public async start(input: {
    workspaceId: WorkspaceId;
    intent: string | null;
  }): Promise<StartSessionResult> {
    const now = this.clock.now();
    const current = await this.sessions.findCurrentByWorkspace(
      input.workspaceId,
    );
    if (current !== null && !current.isIdle(now)) {
      return {
        sessionId: current.getId(),
        previousSessionClosed: false,
      };
    }

    let previousClosed = false;
    if (current !== null) {
      current.end({ occurredAt: now });
      await this.sessions.save(current);
      await this.events.publishAll(current.pullEvents());
      previousClosed = true;
    }

    const fresh = Session.start({
      id: SessionId.from(this.idGen.generateString()),
      workspaceId: input.workspaceId,
      startedAt: now,
      intent:
        input.intent === null || input.intent.trim().length === 0
          ? null
          : SessionIntent.from(input.intent),
      resumedFrom: current === null ? null : current.getId(),
    });
    await this.sessions.save(fresh);
    await this.events.publishAll(fresh.pullEvents());

    return {
      sessionId: fresh.getId(),
      previousSessionClosed: previousClosed,
    };
  }
}
