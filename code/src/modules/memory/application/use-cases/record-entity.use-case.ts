import type { Clock } from "../../../../shared/application/ports/clock.port.ts";
import type { EventPublisher } from "../../../../shared/application/ports/event-publisher.port.ts";
import type { IdGenerator } from "../../../../shared/application/ports/id-generator.port.ts";
import type { Logger } from "../../../../shared/application/ports/logger.port.ts";
import { Confidence } from "../../../../shared/domain/value-objects/confidence.ts";
import type { Tags } from "../../../../shared/domain/value-objects/tags.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import { Entity } from "../../domain/aggregates/entity.ts";
import type { EntityRepository } from "../../domain/repositories/entity-repository.ts";
import { EmbeddingStatus } from "../../domain/value-objects/embedding-status.ts";
import { EntityDescription } from "../../domain/value-objects/entity-description.ts";
import { EntityId } from "../../domain/value-objects/entity-id.ts";
import type { EntityKind } from "../../domain/value-objects/entity-kind.ts";
import { EntityName } from "../../domain/value-objects/entity-name.ts";
import type { Scope } from "../../domain/value-objects/scope.ts";
import type {
  RecordEntity,
  RecordEntityResult,
} from "../ports/in/record-entity.port.ts";
import type { EmbeddingEnqueuer } from "../ports/out/embedding-enqueuer.port.ts";

/**
 * Use case: register a new software-domain `Entity` (or no-op return
 * the existing one).
 *
 * Implements the `RecordEntity` driving port. Soft-idempotent on
 * `(workspaceId, name, kind)`: a duplicate call returns the existing
 * id with `alreadyExisted: true` and does NOT emit a new event.
 */
export class RecordEntityUseCase implements RecordEntity {
  public constructor(
    private readonly entities: EntityRepository,
    private readonly enqueuer: EmbeddingEnqueuer,
    private readonly idGen: IdGenerator,
    private readonly clock: Clock,
    private readonly events: EventPublisher,
    private readonly logger: Logger,
  ) {}

  public async record(input: {
    workspaceId: WorkspaceId;
    name: string;
    kind: EntityKind;
    description: string | null;
    tags: Tags;
    scope: Scope;
  }): Promise<RecordEntityResult> {
    const name = EntityName.from(input.name);
    const existing = await this.entities.findByNameAndKind(
      input.workspaceId,
      name,
      input.kind,
    );
    if (existing !== null) {
      return {
        entityId: existing.getId(),
        embeddingEnqueued: false,
        alreadyExisted: true,
      };
    }

    const now = this.clock.now();
    const entityId = EntityId.from(this.idGen.generateString());
    const description =
      input.description === null ||
      input.description.trim().length === 0
        ? EntityDescription.unknown()
        : EntityDescription.of(input.description);
    const entity = Entity.register({
      id: entityId,
      workspaceId: input.workspaceId,
      name,
      kind: input.kind,
      description,
      tags: input.tags,
      confidence: Confidence.full(),
      scope: input.scope,
      embeddingStatus: EmbeddingStatus.pending(),
      occurredAt: now,
    });

    await this.entities.save(entity);
    await this.events.publishAll(entity.pullEvents());

    const enqueued = await this.tryEnqueue(
      input.workspaceId,
      entityId.toString(),
      now.epochMs,
    );

    return {
      entityId,
      embeddingEnqueued: enqueued,
      alreadyExisted: false,
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
        targetKind: "entity",
        targetRowId,
        enqueuedAt: this.clock.now(),
      });
      return true;
    } catch (cause: unknown) {
      this.logger.warn(
        {
          workspaceId: workspaceId.toString(),
          targetKind: "entity",
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
