import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";

/**
 * Set of legal `RelationKindValue` values.
 *
 * Mirrors the `relations.relation` column documented in
 * `docs/03-modelo-datos.md` §4.6. The schema column is open `TEXT` to
 * keep the persistence layer flexible, but the domain pins a closed
 * vocabulary so callers cannot drift into arbitrary edge labels.
 *
 * Justification for each value:
 * - `references`: a generic "A mentions B" edge (used by capa 5/6 to
 *   pull together related memories).
 * - `supersedes`: the directed link a new decision creates pointing at
 *   the older one it replaces (mirrors `decisions.superseded_by`).
 * - `depends_on`: explicit dependency (`docs/04-capas-contexto.md` §3
 *   uses this label in the Code Map example: "OpenWorkspace uses ...").
 * - `related_to`: weakest catch-all edge for fuzzy associations the
 *   curator may discover.
 */
const RELATION_KINDS = [
  "references",
  "supersedes",
  "depends_on",
  "related_to",
] as const;

export type RelationKindValue = (typeof RELATION_KINDS)[number];

/**
 * Value object representing the kind of a `Relation` edge.
 *
 * Invariants:
 * - The wrapped value is always one of the four known kinds.
 * - Instances are immutable.
 */
export class RelationKind {
  private constructor(public readonly value: RelationKindValue) {}

  public static references(): RelationKind {
    return new RelationKind("references");
  }

  public static supersedes(): RelationKind {
    return new RelationKind("supersedes");
  }

  public static dependsOn(): RelationKind {
    return new RelationKind("depends_on");
  }

  public static relatedTo(): RelationKind {
    return new RelationKind("related_to");
  }

  public static create(raw: string): RelationKind {
    if (typeof raw !== "string") {
      throw new InvalidInputError("relation kind must be a string", {
        field: "relation",
      });
    }
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      throw new InvalidInputError("relation kind must not be empty", {
        field: "relation",
      });
    }
    if (!RelationKind.isValue(trimmed)) {
      throw new InvalidInputError(
        `relation kind must be one of ${RELATION_KINDS.map((k) => `"${k}"`).join(" | ")} (got: "${raw}")`,
        { field: "relation" },
      );
    }
    return new RelationKind(trimmed);
  }

  public static isValue(candidate: string): candidate is RelationKindValue {
    for (const known of RELATION_KINDS) {
      if (known === candidate) return true;
    }
    return false;
  }

  public toString(): RelationKindValue {
    return this.value;
  }

  public equals(other: RelationKind): boolean {
    return this.value === other.value;
  }
}
