import type { Clock } from "../../../../shared/application/ports/clock.port.ts";
import type { Logger } from "../../../../shared/application/ports/logger.port.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { SessionRepository } from "../../../memory/domain/repositories/session-repository.ts";
import { SessionSummary } from "../../../memory/domain/value-objects/session-summary.ts";
import type {
  RollupSession,
  RollupSessionResult,
} from "../ports/in/rollup-session.port.ts";
import type {
  SessionRollupReader,
  TurnRollupProjection,
} from "../ports/out/session-rollup-reader.port.ts";

/**
 * Maximum number of turns the rollup pulls from a session to build
 * the summary. Mirrors `docs/05-memoria-decay.md` §7 ("top 5 por
 * confidence"); the constant lives here so the limit is one value to
 * tune rather than a magic number scattered across SQL and code.
 */
const TOP_TURNS_LIMIT = 5;

/**
 * Soft cap on the generated summary length, in characters. The
 * `SessionSummary` VO enforces its own limits (see
 * `modules/memory/domain/value-objects/session-summary.ts`); the use
 * case truncates at this conservative cap so the VO factory always
 * accepts the output. The exact upper bound is not load-bearing —
 * any value <= the VO cap works.
 */
const SUMMARY_SOFT_CAP_CHARS = 1500;

/**
 * Use case: roll up the workspace's open session if it has timed out.
 *
 * Implements the `RollupSession` driving port. The orchestrator
 * (`RunFullPassUseCase`) calls this first when the curator's trigger
 * is `session_close`; the periodic / nightly trigger also calls it
 * (so an idle session that never closed naturally still gets rolled
 * up after the curator runs).
 *
 * Algorithm (mirrors `docs/05-memoria-decay.md` §7):
 *
 * 1. Load the active session via
 *    `SessionRepository.findCurrentByWorkspace(...)`.
 * 2. If there is no active session, OR the session is not idle
 *    (`Session.isIdle(now) === false`), the use case returns the
 *    zero-result and exits early.
 * 3. Otherwise, fetch the top-5 turns of the session via
 *    `SessionRollupReader.listTopTurns(...)` (ordered by confidence
 *    descending). The reader projects to the flat
 *    `TurnRollupProjection` shape so the rollup never holds full
 *    `Turn` aggregates.
 * 4. Build the summary text by concatenating the turn summaries
 *    with a header (`"Session summary:"`).
 * 5. Call `Session.setSummary(...)` with the new `SessionSummary`
 *    VO, then `Session.end(...)` with the current timestamp.
 * 6. Persist the session via `SessionRepository.save(...)` and
 *    return the counters.
 *
 * Why a separate `SessionRollupReader` (instead of widening the
 * cross-module call into the broader memory ports):
 * - Keeps the cross-import surface (`memory/domain` from
 *   `curator/`) auditable: the only types pulled in are the
 *   aggregate (`Session`), the repository port (`SessionRepository`),
 *   and the summary VO (`SessionSummary`). Every other read path
 *   stays inside the curator's own ports.
 *
 * Idempotency:
 * - When `Session.isIdle(...)` returns false, the use case is a
 *   no-op. When the session has already been ended on a previous
 *   call, `findCurrentByWorkspace(...)` returns `null` and the use
 *   case is again a no-op.
 */
export class RollupSessionUseCase implements RollupSession {
  public constructor(
    private readonly sessions: SessionRepository,
    private readonly rollupReader: SessionRollupReader,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  public async rollup(input: {
    workspaceId: WorkspaceId;
  }): Promise<RollupSessionResult> {
    const session = await this.sessions.findCurrentByWorkspace(
      input.workspaceId,
    );
    if (session === null) {
      return RollupSessionUseCase.empty();
    }
    const now = this.clock.now();
    if (!session.isIdle(now)) {
      return RollupSessionUseCase.empty();
    }

    const turns = await this.rollupReader.listTopTurns({
      workspaceId: input.workspaceId,
      sessionId: session.getId().toString(),
      limit: TOP_TURNS_LIMIT,
    });

    let summariesGenerated = 0;
    if (turns.length > 0) {
      const summary = this.buildSummary(turns);
      session.setSummary({ summary, occurredAt: now });
      summariesGenerated += 1;
    }

    session.end({ occurredAt: now });
    await this.sessions.save(session);

    this.logger.debug(
      {
        workspaceId: input.workspaceId.toString(),
        sessionId: session.getId().toString(),
        turnsConsidered: turns.length,
      },
      "curator: session rolled up",
    );

    return {
      sessionsClosed: 1,
      summariesGenerated,
      learningsCreated: 0,
    };
  }

  /**
   * Concatenates the supplied turn summaries into one
   * `SessionSummary` VO. The MVP rollup uses a deterministic
   * "header + bullets" layout so the resulting summary is human-
   * readable without an LLM round trip.
   */
  private buildSummary(
    turns: readonly TurnRollupProjection[],
  ): SessionSummary {
    const lines: string[] = ["Session summary:"];
    for (const turn of turns) {
      lines.push(`- ${turn.summary}`);
    }
    let body = lines.join("\n");
    if (body.length > SUMMARY_SOFT_CAP_CHARS) {
      body = `${body.slice(0, SUMMARY_SOFT_CAP_CHARS - 3)}...`;
    }
    return SessionSummary.from(body);
  }

  private static empty(): RollupSessionResult {
    return {
      sessionsClosed: 0,
      summariesGenerated: 0,
      learningsCreated: 0,
    };
  }
}
