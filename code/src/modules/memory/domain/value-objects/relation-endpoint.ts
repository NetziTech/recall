import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";
import { DecisionId } from "./decision-id.ts";
import { EntityId } from "./entity-id.ts";
import { LearningId } from "./learning-id.ts";
import { TaskId } from "./task-id.ts";

/**
 * Set of legal `RelationEndpointKind` values.
 *
 * The persistence schema in `docs/03-modelo-datos.md` §4.6
 * (`relations.from_entity_id` / `to_entity_id`) only models
 * entity-to-entity edges. The domain widens that surface so the
 * curator and recall layers can express richer associations across
 * memory kinds (a `Decision` that references a `Learning`, a `Task`
 * blocked by another, etc.) without needing one edge table per
 * combination. The persistence adapter is free to implement that as
 * one polymorphic table or as several specialised tables; the domain
 * stays neutral.
 */
const RELATION_ENDPOINT_KINDS = [
  "decision",
  "learning",
  "entity",
  "task",
] as const;

export type RelationEndpointKind = (typeof RELATION_ENDPOINT_KINDS)[number];

/**
 * Discriminated union view of a relation endpoint.
 *
 * Each variant pins the concrete id type so consumers cannot pass a
 * `LearningId` where a `DecisionId` is expected.
 */
export type RelationEndpointValue =
  | { readonly kind: "decision"; readonly id: DecisionId }
  | { readonly kind: "learning"; readonly id: LearningId }
  | { readonly kind: "entity"; readonly id: EntityId }
  | { readonly kind: "task"; readonly id: TaskId };

/**
 * Value object representing one end of a `Relation` edge.
 *
 * Pairs the endpoint's kind discriminator with the typed id of the
 * memory it points at. The dedicated VO keeps the wire format
 * (`{kind, id}`) symmetrical for `from` and `to` and lets the
 * aggregate enforce shape invariants in one place.
 *
 * The internal storage is a single discriminated-union slot so the
 * "kind matches id" invariant is structurally enforced by the type
 * system (no parallel `kind` + `id` fields, no runtime casts to bridge
 * them). Adding a new endpoint kind in the future is one new factory +
 * one extra arm in the union.
 *
 * Invariants:
 * - The wrapped id matches the wrapped kind: `kind === "decision"`
 *   implies the inner id is a `DecisionId`, etc. (compiler-enforced
 *   via the `RelationEndpointValue` discriminated union).
 * - Instances are immutable.
 */
export class RelationEndpoint {
  private constructor(private readonly value: RelationEndpointValue) {}

  public static decision(id: DecisionId): RelationEndpoint {
    return new RelationEndpoint({ kind: "decision", id });
  }

  public static learning(id: LearningId): RelationEndpoint {
    return new RelationEndpoint({ kind: "learning", id });
  }

  public static entity(id: EntityId): RelationEndpoint {
    return new RelationEndpoint({ kind: "entity", id });
  }

  public static task(id: TaskId): RelationEndpoint {
    return new RelationEndpoint({ kind: "task", id });
  }

  /**
   * Builds a `RelationEndpoint` from a raw kind/id pair (typically
   * arriving from JSON-RPC). Validates the kind and routes to the
   * matching id factory.
   */
  public static create(rawKind: string, rawId: string): RelationEndpoint {
    if (typeof rawKind !== "string") {
      throw new InvalidInputError("relation endpoint kind must be a string", {
        field: "kind",
      });
    }
    const trimmed = rawKind.trim();
    if (!RelationEndpoint.isKind(trimmed)) {
      throw new InvalidInputError(
        `relation endpoint kind must be one of ${RELATION_ENDPOINT_KINDS.map((k) => `"${k}"`).join(" | ")} (got: "${rawKind}")`,
        { field: "kind" },
      );
    }
    switch (trimmed) {
      case "decision":
        return RelationEndpoint.decision(DecisionId.from(rawId));
      case "learning":
        return RelationEndpoint.learning(LearningId.from(rawId));
      case "entity":
        return RelationEndpoint.entity(EntityId.from(rawId));
      case "task":
        return RelationEndpoint.task(TaskId.from(rawId));
      default: {
        // Exhaustiveness guard: if a future kind is added to
        // `RELATION_ENDPOINT_KINDS` without extending this switch, the
        // assignment below becomes a compile-time error.
        const exhaustive: never = trimmed;
        throw new InvalidInputError(
          `unhandled relation endpoint kind: "${String(exhaustive)}"`,
          { field: "kind" },
        );
      }
    }
  }

  public static isKind(candidate: string): candidate is RelationEndpointKind {
    for (const known of RELATION_ENDPOINT_KINDS) {
      if (known === candidate) return true;
    }
    return false;
  }

  /**
   * Returns the discriminator. Convenience getter for callers that only
   * need to know the kind (e.g. when grouping for persistence).
   */
  public get kind(): RelationEndpointKind {
    return this.value.kind;
  }

  /**
   * Returns the discriminated-union view of the endpoint. Useful for
   * pattern matching at the persistence boundary.
   */
  public toValue(): RelationEndpointValue {
    return this.value;
  }

  /**
   * Stringified id of the endpoint. Useful for serialisation and
   * persistence joins where the id alone is meaningful.
   */
  public idAsString(): string {
    return this.value.id.toString();
  }

  public equals(other: RelationEndpoint): boolean {
    if (this === other) return true;
    if (this.value.kind !== other.value.kind) return false;
    return this.value.id.toString() === other.value.id.toString();
  }
}
