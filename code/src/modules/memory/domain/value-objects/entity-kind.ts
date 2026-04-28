import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";

/**
 * Catalogue of legal `EntityKindValue` values.
 *
 * The list is the union of the kinds explicitly named across the docs:
 * - `docs/03-modelo-datos.md` §4.5 (the `entity_kind` column is open
 *   text but the `UNIQUE (name, entity_kind)` constraint shows it acts
 *   as a discriminator);
 * - `docs/02-protocolo-mcp.md` §4.4 (table "Campos especificos por
 *   kind" lists `"struct" | "module" | "service" | "agent" | "file"`);
 * - `docs/04-capas-contexto.md` §3 (Code Map mentions structs, modules,
 *   pages, stores, ...).
 *
 * The MVP picks a closed enum so the type-system catches typos. New
 * kinds get added by editing this list and shipping a migration that
 * accepts the new value (no DB constraint to relax — the column is
 * `TEXT`).
 *
 * Justification for each value:
 * - `function`, `class`, `module`, `service`, `library`: code-shaped
 *   entities the assistant references when reasoning about
 *   architecture.
 * - `concept`: a domain idea (e.g. "Hexagonal", "Coverage policy")
 *   that lives in docs but is not a code symbol.
 * - `person`, `team`: organisational actors (a teammate, a squad) the
 *   assistant may need to remember.
 */
const ENTITY_KINDS = [
  "function",
  "class",
  "module",
  "service",
  "library",
  "concept",
  "person",
  "team",
] as const;

export type EntityKindValue = (typeof ENTITY_KINDS)[number];

/**
 * Value object representing the kind of an `Entity` in the memory
 * graph.
 *
 * Invariants:
 * - The wrapped value is always one of the eight known kinds.
 * - Instances are immutable.
 *
 * Equality:
 * - Two `EntityKind` are equal iff their wrapped values match.
 */
export class EntityKind {
  private constructor(public readonly value: EntityKindValue) {}

  public static functionKind(): EntityKind {
    return new EntityKind("function");
  }

  public static classKind(): EntityKind {
    return new EntityKind("class");
  }

  public static moduleKind(): EntityKind {
    return new EntityKind("module");
  }

  public static serviceKind(): EntityKind {
    return new EntityKind("service");
  }

  public static libraryKind(): EntityKind {
    return new EntityKind("library");
  }

  public static conceptKind(): EntityKind {
    return new EntityKind("concept");
  }

  public static personKind(): EntityKind {
    return new EntityKind("person");
  }

  public static teamKind(): EntityKind {
    return new EntityKind("team");
  }

  /**
   * Builds an `EntityKind` from a raw string (typically read from
   * `entities.entity_kind` or supplied via JSON-RPC).
   */
  public static create(raw: string): EntityKind {
    if (typeof raw !== "string") {
      throw new InvalidInputError("entity kind must be a string", {
        field: "entity_kind",
      });
    }
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      throw new InvalidInputError("entity kind must not be empty", {
        field: "entity_kind",
      });
    }
    if (!EntityKind.isValue(trimmed)) {
      throw new InvalidInputError(
        `entity kind must be one of ${ENTITY_KINDS.map((k) => `"${k}"`).join(" | ")} (got: "${raw}")`,
        { field: "entity_kind" },
      );
    }
    return new EntityKind(trimmed);
  }

  /**
   * Type guard exposed for raw-string validation.
   */
  public static isValue(candidate: string): candidate is EntityKindValue {
    for (const known of ENTITY_KINDS) {
      if (known === candidate) return true;
    }
    return false;
  }

  public toString(): EntityKindValue {
    return this.value;
  }

  public equals(other: EntityKind): boolean {
    return this.value === other.value;
  }
}
