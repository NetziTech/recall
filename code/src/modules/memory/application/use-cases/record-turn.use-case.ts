import type { Clock } from "../../../../shared/application/ports/clock.port.ts";
import type { EventPublisher } from "../../../../shared/application/ports/event-publisher.port.ts";
import type { IdGenerator } from "../../../../shared/application/ports/id-generator.port.ts";
import type { Logger } from "../../../../shared/application/ports/logger.port.ts";
import { Confidence } from "../../../../shared/domain/value-objects/confidence.ts";
import type { Tags } from "../../../../shared/domain/value-objects/tags.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import { Turn } from "../../domain/aggregates/turn.ts";
import type { SessionRepository } from "../../domain/repositories/session-repository.ts";
import type { TurnRepository } from "../../domain/repositories/turn-repository.ts";
import type { DecisionId } from "../../domain/value-objects/decision-id.ts";
import { FilesTouched } from "../../domain/value-objects/files-touched.ts";
import type { LearningId } from "../../domain/value-objects/learning-id.ts";
import { LinkedDecisionIds } from "../../domain/value-objects/linked-decision-ids.ts";
import { LinkedLearningIds } from "../../domain/value-objects/linked-learning-ids.ts";
import { TurnId } from "../../domain/value-objects/turn-id.ts";
import { TurnIntent } from "../../domain/value-objects/turn-intent.ts";
import { TurnOutcome } from "../../domain/value-objects/turn-outcome.ts";
import { TurnSummary } from "../../domain/value-objects/turn-summary.ts";
import type {
  RecordTurn,
  RecordTurnResult,
} from "../ports/in/record-turn.port.ts";
import type { EmbeddingEnqueuer } from "../ports/out/embedding-enqueuer.port.ts";
import type { SessionContextHelper } from "./session-context-helper.ts";

/**
 * Use case: append a `Turn` to the workspace's history.
 *
 * Implements the `RecordTurn` driving port. The use case is the
 * central event of the implicit-session model:
 *
 * 1. `SessionContextHelper.acquire(...)` returns the session to attach
 *    to, opening or rotating one as needed.
 * 2. The `Turn` aggregate is built and persisted.
 * 3. The session's activity counters are bumped via
 *    `Session.recordActivity(...)` and saved.
 * 4. Domain events from BOTH aggregates are published (in order:
 *    session events first, then turn events — subscribers that observe
 *    `SessionStarted` and `TurnRecorded` see the lifecycle in causal
 *    order).
 * 5. The embedding job is enqueued.
 */
export class RecordTurnUseCase implements RecordTurn {
  public constructor(
    private readonly turns: TurnRepository,
    private readonly sessions: SessionRepository,
    private readonly sessionHelper: SessionContextHelper,
    private readonly enqueuer: EmbeddingEnqueuer,
    private readonly idGen: IdGenerator,
    private readonly clock: Clock,
    private readonly events: EventPublisher,
    private readonly logger: Logger,
  ) {}

  public async record(input: {
    workspaceId: WorkspaceId;
    summary: string;
    intent: string | null;
    outcome: string | null;
    filesTouched: readonly string[];
    linkedDecisions: readonly DecisionId[];
    linkedLearnings: readonly LearningId[];
    tags: Tags;
  }): Promise<RecordTurnResult> {
    const acquired = await this.sessionHelper.acquire({
      workspaceId: input.workspaceId,
      intent: null,
    });
    const session = acquired.session;

    const now = this.clock.now();
    const turnId = TurnId.from(this.idGen.generateString());
    const turn = Turn.record({
      id: turnId,
      workspaceId: input.workspaceId,
      sessionId: session.getId(),
      summary: TurnSummary.from(input.summary),
      intent: input.intent === null ? null : TurnIntent.from(input.intent),
      outcome:
        input.outcome === null ? null : TurnOutcome.from(input.outcome),
      filesTouched: FilesTouched.create(input.filesTouched),
      linkedDecisions: LinkedDecisionIds.create(input.linkedDecisions),
      linkedLearnings: LinkedLearningIds.create(input.linkedLearnings),
      tags: input.tags,
      confidence: Confidence.full(),
      occurredAt: now,
    });

    session.recordActivity(now);

    await this.turns.save(turn);
    await this.sessions.save(session);

    await this.events.publishAll(session.pullEvents());
    await this.events.publishAll(turn.pullEvents());

    const enqueued = await this.tryEnqueue(
      input.workspaceId,
      turnId.toString(),
      now.epochMs,
    );

    return {
      turnId,
      sessionId: session.getId(),
      embeddingEnqueued: enqueued,
    };
  }

  private async tryEnqueue(
    workspaceId: WorkspaceId,
    targetRowId: string,
    epochMs: number,
  ): Promise<boolean> {
    try {
      await this.enqueuer.enqueue({
        workspaceId,
        targetKind: "turn",
        targetRowId,
        enqueuedAt: this.clock.now(),
      });
      return true;
    } catch (cause: unknown) {
      this.logger.warn(
        {
          workspaceId: workspaceId.toString(),
          targetKind: "turn",
          targetRowId,
          enqueuedAtMs: epochMs,
          err: cause instanceof Error ? cause.message : "unknown",
        },
        "embedding enqueue failed; turn persisted without embedding job",
      );
      return false;
    }
  }
}
