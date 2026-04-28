import type { DomainEvent } from "../../../../shared/domain/types/domain-event.ts";
import type { Confidence } from "../../../../shared/domain/value-objects/confidence.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import { RelationSelfLoopError } from "../errors/relation-self-loop-error.ts";
import { RelationCreated } from "../events/relation-created.ts";
import type { RelationEndpoint } from "../value-objects/relation-endpoint.ts";
import type { RelationId } from "../value-objects/relation-id.ts";
import type { RelationKind } from "../value-objects/relation-kind.ts";

/**
 * Aggregate root for an edge in the memory graph.
 *
 * Modelled as an aggregate root (rather than a child of either
 * endpoint) because:
 *
 * - The two endpoints can belong to different aggregates (a `Decision`
 *   referencing a `Learning`, an `Entity` depending on a `Task`, ...).
 *   Choosing one of them as parent would arbitrarily privilege that
 *   side and complicate persistence (deletes would have to cascade
 *   from a single owner).
 * - Edges have their own identity (`relations.id`,
 *   `docs/03-modelo-datos.md` §4.6) and lifetime, including a
 *   `confidence` weight that the curator can decay independently of
 *   the connected memories.
 * - Deletion of an edge is a domain event in its own right (the
 *   recall layer needs to react to invalidate caches).
 *
 * The persistence schema in `docs/03-modelo-datos.md` §4.6 only models
 * entity-to-entity edges (`from_entity_id` / `to_entity_id` are FKs to
 * `entities.id` with a `UNIQUE (from_entity_id, to_entity_id,
 * relation)` constraint); the domain widens that surface (see
 * `RelationEndpoint`) so the recall layer can express richer
 * associations.
 *
 * **Persistence ADR — pending decision (Fase 2/3):** the infrastructure
 * adapter MUST choose between two storage strategies before the first
 * non-entity-to-entity relation is persisted, and that choice should
 * be captured as an explicit ADR in `docs/03-modelo-datos.md` §4.6:
 *
 * 1. **Polymorphic table** — keep `relations` for legacy
 *    entity-to-entity edges and add a sibling
 *    `relations_polymorphic (from_kind, from_id, to_kind, to_id,
 *    relation, ...)`. Loses `REFERENCES entities(id)` integrity but
 *    keeps the schema flexible.
 * 2. **Specialised tables** — one edge table per kind pair
 *    (`relations_decision_to_learning`, ...). Preserves FK integrity
 *    but explodes combinatorially as more endpoint kinds are added.
 *
 * Until the ADR is filed, only entity-to-entity relations are safe to
 * persist via the existing schema. The domain stays neutral and emits
 * the same `RelationCreated` event regardless of the chosen strategy.
 *
 * Invariants:
 * - Identity is immutable.
 * - `from` and `to` are different endpoints (the aggregate refuses
 *   self-loops via `RelationSelfLoopError`).
 * - The wrapped fields are read-only after construction. There is no
 *   "update" mutation; edges either exist or do not. The curator
 *   creates a new edge with the updated confidence and (optionally)
 *   deletes the previous one — but deletion is a repository concern,
 *   not a domain mutation.
 */
export class Relation {
  private readonly id: RelationId;
  private readonly workspaceId: WorkspaceId;
  private readonly from: RelationEndpoint;
  private readonly to: RelationEndpoint;
  private readonly kind: RelationKind;
  private readonly weight: Confidence;
  private readonly createdAt: Timestamp;
  private readonly events: DomainEvent[];

  private constructor(input: {
    id: RelationId;
    workspaceId: WorkspaceId;
    from: RelationEndpoint;
    to: RelationEndpoint;
    kind: RelationKind;
    weight: Confidence;
    createdAt: Timestamp;
    events: readonly DomainEvent[];
  }) {
    this.id = input.id;
    this.workspaceId = input.workspaceId;
    this.from = input.from;
    this.to = input.to;
    this.kind = input.kind;
    this.weight = input.weight;
    this.createdAt = input.createdAt;
    this.events = [...input.events];
  }

  /**
   * Brings a brand-new `Relation` into existence. Refuses self-loops
   * (`from` and `to` pointing at the same memory entry). Emits
   * `RelationCreated`.
   */
  public static create(input: {
    id: RelationId;
    workspaceId: WorkspaceId;
    from: RelationEndpoint;
    to: RelationEndpoint;
    kind: RelationKind;
    weight: Confidence;
    occurredAt: Timestamp;
  }): Relation {
    if (input.from.equals(input.to)) {
      throw new RelationSelfLoopError(input.from);
    }
    const event = new RelationCreated({
      workspaceId: input.workspaceId,
      relationId: input.id,
      from: input.from,
      to: input.to,
      kind: input.kind,
      occurredAt: input.occurredAt,
    });
    return new Relation({
      id: input.id,
      workspaceId: input.workspaceId,
      from: input.from,
      to: input.to,
      kind: input.kind,
      weight: input.weight,
      createdAt: input.occurredAt,
      events: [event],
    });
  }

  /**
   * Rehydrates a `Relation` from previously-persisted state. Does NOT
   * emit any event and does NOT re-check the self-loop invariant
   * (persisted state is trusted; if it is malformed we want the bug
   * to surface elsewhere, not here).
   */
  public static rehydrate(input: {
    id: RelationId;
    workspaceId: WorkspaceId;
    from: RelationEndpoint;
    to: RelationEndpoint;
    kind: RelationKind;
    weight: Confidence;
    createdAt: Timestamp;
  }): Relation {
    return new Relation({
      id: input.id,
      workspaceId: input.workspaceId,
      from: input.from,
      to: input.to,
      kind: input.kind,
      weight: input.weight,
      createdAt: input.createdAt,
      events: [],
    });
  }

  // -- queries -------------------------------------------------------------

  public getId(): RelationId {
    return this.id;
  }

  public getWorkspaceId(): WorkspaceId {
    return this.workspaceId;
  }

  public getFrom(): RelationEndpoint {
    return this.from;
  }

  public getTo(): RelationEndpoint {
    return this.to;
  }

  public getKind(): RelationKind {
    return this.kind;
  }

  public getWeight(): Confidence {
    return this.weight;
  }

  public getCreatedAt(): Timestamp {
    return this.createdAt;
  }

  public pullEvents(): readonly DomainEvent[] {
    if (this.events.length === 0) return Object.freeze([]);
    const drained = this.events.slice();
    this.events.length = 0;
    return Object.freeze(drained);
  }
}
