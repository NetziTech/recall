import type { WorkspaceId } from "../../../../../shared/domain/value-objects/workspace-id.ts";
import type { RelationEndpoint } from "../../../domain/value-objects/relation-endpoint.ts";
import type { RelationId } from "../../../domain/value-objects/relation-id.ts";
import type { RelationKind } from "../../../domain/value-objects/relation-kind.ts";

/**
 * Result of a `RecordRelation` invocation.
 */
export interface RecordRelationResult {
  readonly relationId: RelationId;
}

/**
 * Driving (input) port: create an edge in the memory graph.
 *
 * Mirrors `relations` from `docs/03-modelo-datos.md` §4.6. The MVP
 * only persists entity-to-entity edges (the schema's
 * `from_entity_id`/`to_entity_id` are FKs to `entities.id`); the
 * domain widens that surface (see `RelationEndpoint`) but the
 * persistence adapter rejects non-entity endpoints until the
 * polymorphic-table ADR is filed (see the JSDoc in the `Relation`
 * aggregate).
 *
 * Pre-conditions:
 * - The `from` endpoint is well-formed and points at an existing
 *   memory entry of the right kind. The use case verifies entity
 *   endpoints exist (`EntityRepository.findById`) before calling
 *   `Relation.create(...)` — the SQL `FOREIGN KEY` would surface a
 *   late error otherwise.
 * - `from` and `to` are different (the aggregate refuses self-loops).
 */
export interface RecordRelation {
  record(input: {
    workspaceId: WorkspaceId;
    from: RelationEndpoint;
    to: RelationEndpoint;
    kind: RelationKind;
    weightValue: number;
  }): Promise<RecordRelationResult>;
}
