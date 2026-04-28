import type { Confidence } from "../../../../shared/domain/value-objects/confidence.ts";
import type { EntityDescription } from "../../../memory/domain/value-objects/entity-description.ts";
import type { EntityId } from "../../../memory/domain/value-objects/entity-id.ts";
import type { EntityKind } from "../../../memory/domain/value-objects/entity-kind.ts";
import type { EntityName } from "../../../memory/domain/value-objects/entity-name.ts";
import type { RelevanceScore } from "./relevance-score.ts";

/**
 * Lightweight reference to an `Entity` aggregate, suitable for
 * inclusion in the `entities_in_focus` layer of a `ContextBundle`.
 *
 * Mirrors the doc's example bundle in `docs/04-capas-contexto.md` §3.6
 * ("Capa 6 — Code Map") which renders each entity as
 * `<Name> (<entity_kind>) ← <location>` plus an optional one-line
 * description and the outgoing relations as a tree.
 *
 * The `relations` of an entity are NOT carried inside this ref. The
 * bundle assembler resolves them by walking the relations graph
 * (max_depth 2 per `docs/02-protocolo-mcp.md` §5.1) and emits a
 * separate set of `EntityRef`s for the neighbours; the relation edges
 * themselves are part of the layer payload, not part of any single
 * ref. This keeps each ref focused on one entity and avoids cycles
 * during graph traversal.
 *
 * Invariants:
 * - All fields are validated VOs.
 * - `location` is a `string | null` (the underlying column is nullable;
 *   wrapping in a VO would require a path/locator VO that is out of
 *   scope for the retrieval bounded context).
 * - Instances are immutable.
 *
 * Equality:
 * - Two `EntityRef` are equal iff their ids match.
 */
export class EntityRef {
  private constructor(
    public readonly id: EntityId,
    public readonly name: EntityName,
    public readonly entityKind: EntityKind,
    public readonly description: EntityDescription,
    public readonly location: string | null,
    public readonly confidence: Confidence,
    public readonly relevanceScore: RelevanceScore,
  ) {}

  public static of(input: {
    id: EntityId;
    name: EntityName;
    entityKind: EntityKind;
    description: EntityDescription;
    location: string | null;
    confidence: Confidence;
    relevanceScore: RelevanceScore;
  }): EntityRef {
    return new EntityRef(
      input.id,
      input.name,
      input.entityKind,
      input.description,
      input.location,
      input.confidence,
      input.relevanceScore,
    );
  }

  public equals(other: EntityRef): boolean {
    if (this === other) return true;
    return this.id.equals(other.id);
  }
}
