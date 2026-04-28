import type { Clock } from "../../../../shared/application/ports/clock.port.ts";
import type { EventPublisher } from "../../../../shared/application/ports/event-publisher.port.ts";
import type { IdGenerator } from "../../../../shared/application/ports/id-generator.port.ts";
import { Confidence } from "../../../../shared/domain/value-objects/confidence.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import { Relation } from "../../domain/aggregates/relation.ts";
import type { EntityRepository } from "../../domain/repositories/entity-repository.ts";
import type { RelationRepository } from "../../domain/repositories/relation-repository.ts";
import type { RelationEndpoint } from "../../domain/value-objects/relation-endpoint.ts";
import { RelationId } from "../../domain/value-objects/relation-id.ts";
import type { RelationKind } from "../../domain/value-objects/relation-kind.ts";
import { EntityId } from "../../domain/value-objects/entity-id.ts";
import { MemoryApplicationError } from "../errors/memory-application-error.ts";
import type {
  RecordRelation,
  RecordRelationResult,
} from "../ports/in/record-relation.port.ts";

/**
 * Use case: create an edge in the memory graph.
 *
 * Implements the `RecordRelation` driving port. The MVP only persists
 * entity-to-entity edges (the schema's
 * `relations.from_entity_id`/`to_entity_id` are FKs); the use case
 * verifies BOTH entity endpoints exist before invoking
 * `Relation.create(...)` so a missing-FK error never reaches SQL.
 *
 * Defence in depth: when an endpoint is non-entity (which the domain
 * allows but persistence does not), the use case throws
 * `MemoryApplicationError.relationEndpointMissing`. The composition
 * root may revisit this once the polymorphic-relations ADR lands.
 */
export class RecordRelationUseCase implements RecordRelation {
  public constructor(
    private readonly relations: RelationRepository,
    private readonly entities: EntityRepository,
    private readonly idGen: IdGenerator,
    private readonly clock: Clock,
    private readonly events: EventPublisher,
  ) {}

  public async record(input: {
    workspaceId: WorkspaceId;
    from: RelationEndpoint;
    to: RelationEndpoint;
    kind: RelationKind;
    weightValue: number;
  }): Promise<RecordRelationResult> {
    await this.assertEntityEndpoint("from", input.from);
    await this.assertEntityEndpoint("to", input.to);

    const now = this.clock.now();
    const relationId = RelationId.from(this.idGen.generateString());
    const relation = Relation.create({
      id: relationId,
      workspaceId: input.workspaceId,
      from: input.from,
      to: input.to,
      kind: input.kind,
      weight: Confidence.of(input.weightValue),
      occurredAt: now,
    });

    await this.relations.save(relation);
    await this.events.publishAll(relation.pullEvents());

    return { relationId };
  }

  /**
   * Throws when the endpoint either is not an entity or points at an
   * entity id that does not exist.
   */
  private async assertEntityEndpoint(
    side: "from" | "to",
    endpoint: RelationEndpoint,
  ): Promise<void> {
    const view = endpoint.toValue();
    if (view.kind !== "entity") {
      throw MemoryApplicationError.relationEndpointMissing(
        side,
        endpoint.idAsString(),
      );
    }
    const entity = await this.entities.findById(
      EntityId.from(view.id.toString()),
    );
    if (entity === null) {
      throw MemoryApplicationError.relationEndpointMissing(
        side,
        endpoint.idAsString(),
      );
    }
  }
}
