import type { Clock } from "../../../../shared/application/ports/clock.port.ts";
import type { EventPublisher } from "../../../../shared/application/ports/event-publisher.port.ts";
import type { IdGenerator } from "../../../../shared/application/ports/id-generator.port.ts";
import type { Logger } from "../../../../shared/application/ports/logger.port.ts";
import { Confidence } from "../../../../shared/domain/value-objects/confidence.ts";
import type { Tags } from "../../../../shared/domain/value-objects/tags.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import { Learning } from "../../domain/aggregates/learning.ts";
import type { LearningRepository } from "../../domain/repositories/learning-repository.ts";
import { EmbeddingStatus } from "../../domain/value-objects/embedding-status.ts";
import { LearningId } from "../../domain/value-objects/learning-id.ts";
import { LearningSeverity } from "../../domain/value-objects/learning-severity.ts";
import { LearningText } from "../../domain/value-objects/learning-text.ts";
import type { Scope } from "../../domain/value-objects/scope.ts";
import type {
  RecordLearning,
  RecordLearningResult,
} from "../ports/in/record-learning.port.ts";
import type { EmbeddingEnqueuer } from "../ports/out/embedding-enqueuer.port.ts";

/**
 * Use case: record a brand-new `Learning`.
 *
 * Implements the `RecordLearning` driving port. Mirrors the structure
 * of `RecordDecisionUseCase` (mint id, build aggregate, save, publish
 * events, enqueue embedding) for the learning kind.
 *
 * Defaults:
 * - `severity`        : `tip` when the caller passes `null`.
 * - `confidence`      : 1.0.
 * - `embeddingStatus` : `pending`.
 */
export class RecordLearningUseCase implements RecordLearning {
  public constructor(
    private readonly learnings: LearningRepository,
    private readonly enqueuer: EmbeddingEnqueuer,
    private readonly idGen: IdGenerator,
    private readonly clock: Clock,
    private readonly events: EventPublisher,
    private readonly logger: Logger,
  ) {}

  public async record(input: {
    workspaceId: WorkspaceId;
    text: string;
    severity: LearningSeverity | null;
    tags: Tags;
    scope: Scope;
  }): Promise<RecordLearningResult> {
    const now = this.clock.now();
    const learningId = LearningId.from(this.idGen.generateString());
    const learning = Learning.register({
      id: learningId,
      workspaceId: input.workspaceId,
      text: LearningText.from(input.text),
      severity: input.severity ?? LearningSeverity.tip(),
      tags: input.tags,
      confidence: Confidence.full(),
      scope: input.scope,
      embeddingStatus: EmbeddingStatus.pending(),
      occurredAt: now,
    });

    await this.learnings.save(learning);
    await this.events.publishAll(learning.pullEvents());

    const enqueued = await this.tryEnqueue(
      input.workspaceId,
      learningId.toString(),
      now.epochMs,
    );

    return { learningId, embeddingEnqueued: enqueued };
  }

  private async tryEnqueue(
    workspaceId: WorkspaceId,
    targetRowId: string,
    epochMs: number,
  ): Promise<boolean> {
    try {
      await this.enqueuer.enqueue({
        workspaceId,
        targetKind: "learning",
        targetRowId,
        enqueuedAt: this.clock.now(),
      });
      return true;
    } catch (cause: unknown) {
      this.logger.warn(
        {
          workspaceId: workspaceId.toString(),
          targetKind: "learning",
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
