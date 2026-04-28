import type { Clock } from "../../../../shared/application/ports/clock.port.ts";
import type { EventPublisher } from "../../../../shared/application/ports/event-publisher.port.ts";
import type { IdGenerator } from "../../../../shared/application/ports/id-generator.port.ts";
import type { Logger } from "../../../../shared/application/ports/logger.port.ts";
import type { Tags } from "../../../../shared/domain/value-objects/tags.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import { Confidence } from "../../../../shared/domain/value-objects/confidence.ts";
import { Decision } from "../../domain/aggregates/decision.ts";
import type { DecisionRepository } from "../../domain/repositories/decision-repository.ts";
import { DecisionId } from "../../domain/value-objects/decision-id.ts";
import { DecisionTitle } from "../../domain/value-objects/decision-title.ts";
import { EmbeddingStatus } from "../../domain/value-objects/embedding-status.ts";
import { Rationale } from "../../domain/value-objects/rationale.ts";
import type { Scope } from "../../domain/value-objects/scope.ts";
import type { SessionId } from "../../domain/value-objects/session-id.ts";
import type {
  RecordDecision,
  RecordDecisionResult,
} from "../ports/in/record-decision.port.ts";
import type { EmbeddingEnqueuer } from "../ports/out/embedding-enqueuer.port.ts";

/**
 * Use case: record a brand-new architectural `Decision`.
 *
 * Implements the `RecordDecision` driving port. Orchestrates the
 * `DecisionRepository`, `IdGenerator`, `Clock`, `EventPublisher`,
 * and `EmbeddingEnqueuer` to:
 *
 * 1. Mint a fresh `DecisionId` (UUID v7).
 * 2. Build the `Decision` aggregate via `Decision.record(...)`. The
 *    factory emits `DecisionRecorded`.
 * 3. Persist the aggregate via `DecisionRepository.save(...)`.
 * 4. Drain buffered events and publish them.
 * 5. Enqueue the embedding job (best-effort; a failure logs a warn
 *    but does NOT roll back the row write — embeddings are
 *    regenerable, see `docs/03-modelo-datos.md` §5).
 *
 * Why a class (not a free function):
 * - The composition root injects six collaborators exactly once. A
 *   function would force every caller to plumb them all the way
 *   through.
 *
 * Defaults applied at this layer:
 * - `confidence`     : 1.0 (full).
 * - `embeddingStatus`: `pending` (the queue worker fills it).
 *
 * Error semantics:
 * - VO factories (`DecisionTitle.from`, `Rationale.from`) throw
 *   `InvalidInputError` on malformed input — propagated to the caller
 *   unchanged.
 * - Persistence failures bubble as
 *   `MemoryInfrastructureError.upsertFailed`.
 * - Enqueue failures are caught and logged; the `embeddingEnqueued`
 *   flag in the result reflects whether the side-effect succeeded.
 */
export class RecordDecisionUseCase implements RecordDecision {
  public constructor(
    private readonly decisions: DecisionRepository,
    private readonly enqueuer: EmbeddingEnqueuer,
    private readonly idGen: IdGenerator,
    private readonly clock: Clock,
    private readonly events: EventPublisher,
    private readonly logger: Logger,
  ) {}

  public async record(input: {
    workspaceId: WorkspaceId;
    sessionId: SessionId | null;
    title: string;
    rationale: string;
    tags: Tags;
    scope: Scope;
  }): Promise<RecordDecisionResult> {
    const now = this.clock.now();
    const decisionId = DecisionId.from(this.idGen.generateString());
    const decision = Decision.record({
      id: decisionId,
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      title: DecisionTitle.from(input.title),
      rationale: Rationale.from(input.rationale),
      tags: input.tags,
      confidence: Confidence.full(),
      scope: input.scope,
      embeddingStatus: EmbeddingStatus.pending(),
      occurredAt: now,
    });

    await this.decisions.save(decision);
    await this.events.publishAll(decision.pullEvents());

    const enqueued = await this.tryEnqueue(
      input.workspaceId,
      decisionId.toString(),
      now.epochMs,
    );

    return { decisionId, embeddingEnqueued: enqueued };
  }

  private async tryEnqueue(
    workspaceId: WorkspaceId,
    targetRowId: string,
    epochMs: number,
  ): Promise<boolean> {
    try {
      await this.enqueuer.enqueue({
        workspaceId,
        targetKind: "decision",
        targetRowId,
        enqueuedAt: this.clock.now(),
      });
      return true;
    } catch (cause: unknown) {
      this.logger.warn(
        {
          workspaceId: workspaceId.toString(),
          targetKind: "decision",
          targetRowId,
          enqueuedAtMs: epochMs,
          err: cause instanceof Error ? cause.message : "unknown",
        },
        "embedding enqueue failed; entry persisted without embedding job",
      );
      return false;
    }
  }
}
