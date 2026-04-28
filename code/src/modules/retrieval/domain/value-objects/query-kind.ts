import { InvalidQueryError } from "../errors/invalid-query-error.ts";

/**
 * Catalogue of legal `QueryKindValue` values.
 *
 * Mirrors the `Kind` union of the `mem.recall` protocol input
 * (`docs/02-protocolo-mcp.md` §4.3:
 * `"decision" | "learning" | "turn" | "entity" | "task"`). The literal
 * `"any"` exposed by the protocol is NOT modelled here: in the domain
 * "filter by any kind" is represented by the *absence* of a kind filter
 * (the `Query.kinds` array is empty), which is more honest than carrying
 * a sentinel value through the pipeline.
 *
 * The catalogue is the single source of truth for the recall path: the
 * lexical and vector search ports return tuples discriminated by this
 * union, and the `RankedEntry` projection echoes it back to the caller.
 */
const QUERY_KINDS = [
  "decision",
  "learning",
  "entity",
  "task",
  "turn",
] as const;

export type QueryKindValue = (typeof QUERY_KINDS)[number];

/**
 * Value object representing one selectable kind of memory entry.
 *
 * Wraps a literal from the `QUERY_KINDS` catalogue. The VO exists
 * (rather than passing the raw string around) so the type system
 * guarantees that callers never accidentally feed a free-form string
 * to the search ports — every concrete kind goes through validation
 * once in `create(...)`.
 *
 * Invariants:
 * - The wrapped value is one of the five known literals.
 * - Instances are immutable.
 *
 * Equality:
 * - Two `QueryKind` are equal iff their wrapped literals match.
 */
export class QueryKind {
  private constructor(public readonly value: QueryKindValue) {}

  public static decision(): QueryKind {
    return new QueryKind("decision");
  }

  public static learning(): QueryKind {
    return new QueryKind("learning");
  }

  public static entity(): QueryKind {
    return new QueryKind("entity");
  }

  public static task(): QueryKind {
    return new QueryKind("task");
  }

  public static turn(): QueryKind {
    return new QueryKind("turn");
  }

  /**
   * Builds a `QueryKind` from a raw string. Trims, lowercases, and
   * checks membership in the catalogue.
   */
  public static create(raw: string): QueryKind {
    if (typeof raw !== "string") {
      throw new InvalidQueryError("query kind must be a string", {
        field: "kind",
      });
    }
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      throw new InvalidQueryError("query kind must not be empty", {
        field: "kind",
      });
    }
    if (!QueryKind.isValue(trimmed)) {
      throw new InvalidQueryError(
        `query kind must be one of ${QUERY_KINDS.map((k) => `"${k}"`).join(" | ")} (got: "${raw}")`,
        { field: "kind" },
      );
    }
    return new QueryKind(trimmed);
  }

  /**
   * Type guard exposed for raw-string validation.
   */
  public static isValue(candidate: string): candidate is QueryKindValue {
    for (const known of QUERY_KINDS) {
      if (known === candidate) return true;
    }
    return false;
  }

  /**
   * Returns the full catalogue. Useful for adapters that need to
   * iterate over every kind (e.g. running the same search across all
   * tables when no `kinds` filter is supplied).
   */
  public static all(): readonly QueryKindValue[] {
    return QUERY_KINDS;
  }

  public toString(): QueryKindValue {
    return this.value;
  }

  public equals(other: QueryKind): boolean {
    return this.value === other.value;
  }
}
