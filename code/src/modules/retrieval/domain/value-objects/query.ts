import type { Tags } from "../../../../shared/domain/value-objects/tags.ts";
import { InvalidQueryError } from "../errors/invalid-query-error.ts";
import type { QueryKind} from "./query-kind.ts";
import { type QueryKindValue } from "./query-kind.ts";
import type { QueryText } from "./query-text.ts";

/**
 * Composite value object that collects every input parameter of a recall
 * operation into a single immutable bundle.
 *
 * Mirrors the input shape of `mem.recall` documented in
 * `docs/02-protocolo-mcp.md` §4.3:
 * - `text` — the free-form query string (always required at this VO; the
 *   "no query" path of `mem.recall` is modelled at the application layer
 *   by simply not building a `Query`).
 * - `kinds` — restrict the search to a subset of memory kinds. Empty
 *   array means "all kinds" (the protocol's `"any"` literal does NOT
 *   leak into the domain — see `query-kind.ts`).
 * - `tags` — informational tag filter (no special semantics on its own;
 *   mostly carried through for adapter convenience).
 * - `mustHaveTags` — every entry returned MUST carry every tag in this
 *   set (`must_have_tags` in the protocol).
 * - `mustNotHaveTags` — entries carrying any of these tags are excluded
 *   (`must_not_have_tags` in the protocol).
 * - `includeSuperseded` — when `true`, decisions with
 *   `superseded_by IS NOT NULL` are included in the candidate set
 *   (`include_superseded` in the protocol; defaults to `false`).
 *
 * Invariants:
 * - `text` is a valid `QueryText` (already validated by its own VO).
 * - `kinds` is a frozen, deduplicated array of `QueryKind` instances.
 *   Duplicates are rejected at construction.
 * - `mustHaveTags` and `mustNotHaveTags` MUST share no tag — asking for
 *   a tag that is also forbidden contradicts itself and would always
 *   yield zero results, which is almost certainly a bug in the caller.
 * - Instances are immutable. Mutation produces a new `Query`.
 */
export class Query {
  private readonly kindValues: readonly QueryKind[];

  private constructor(
    public readonly text: QueryText,
    kinds: readonly QueryKind[],
    public readonly tags: Tags,
    public readonly mustHaveTags: Tags,
    public readonly mustNotHaveTags: Tags,
    public readonly includeSuperseded: boolean,
  ) {
    this.kindValues = kinds;
  }

  /**
   * Builds a `Query` from validated value-object inputs.
   *
   * - Deduplicates `kinds` (two `QueryKind` instances with the same
   *   literal collapse into one entry).
   * - Refuses contradictory `mustHaveTags` / `mustNotHaveTags` overlap.
   */
  public static create(input: {
    text: QueryText;
    kinds: readonly QueryKind[];
    tags: Tags;
    mustHaveTags: Tags;
    mustNotHaveTags: Tags;
    includeSuperseded: boolean;
  }): Query {
    const dedupedKinds = Query.dedupeKinds(input.kinds);
    Query.assertTagFilterCoherence(input.mustHaveTags, input.mustNotHaveTags);
    return new Query(
      input.text,
      dedupedKinds,
      input.tags,
      input.mustHaveTags,
      input.mustNotHaveTags,
      input.includeSuperseded,
    );
  }

  /**
   * Returns the configured kinds as a frozen array of VOs.
   */
  public getKinds(): readonly QueryKind[] {
    return this.kindValues;
  }

  /**
   * Returns the configured kinds as a frozen array of literals — useful
   * for adapters (e.g. SQL `WHERE kind IN (...)`).
   */
  public getKindValues(): readonly QueryKindValue[] {
    const out: QueryKindValue[] = [];
    for (const k of this.kindValues) {
      out.push(k.value);
    }
    return Object.freeze(out);
  }

  /**
   * True iff the caller did not specify any kind filter (i.e. "search
   * across every kind").
   */
  public hasNoKindFilter(): boolean {
    return this.kindValues.length === 0;
  }

  /**
   * True iff `kind` is included in (or no filter is set).
   */
  public matchesKind(kind: QueryKind): boolean {
    if (this.kindValues.length === 0) return true;
    for (const known of this.kindValues) {
      if (known.equals(kind)) return true;
    }
    return false;
  }

  public equals(other: Query): boolean {
    if (this === other) return true;
    if (!this.text.equals(other.text)) return false;
    if (this.includeSuperseded !== other.includeSuperseded) return false;
    if (!this.tags.equals(other.tags)) return false;
    if (!this.mustHaveTags.equals(other.mustHaveTags)) return false;
    if (!this.mustNotHaveTags.equals(other.mustNotHaveTags)) return false;
    if (this.kindValues.length !== other.kindValues.length) return false;
    for (let i = 0; i < this.kindValues.length; i += 1) {
      const a = this.kindValues[i];
      const b = other.kindValues[i];
      if (a === undefined || b === undefined) return false;
      if (!a.equals(b)) return false;
    }
    return true;
  }

  // -- internals -----------------------------------------------------------

  private static dedupeKinds(
    kinds: readonly QueryKind[],
  ): readonly QueryKind[] {
    const seen = new Set<string>();
    const out: QueryKind[] = [];
    for (const candidate of kinds) {
      const literal = candidate.value;
      if (seen.has(literal)) continue;
      seen.add(literal);
      out.push(candidate);
    }
    return Object.freeze(out);
  }

  private static assertTagFilterCoherence(
    mustHave: Tags,
    mustNot: Tags,
  ): void {
    if (mustHave.isEmpty() || mustNot.isEmpty()) return;
    if (mustHave.intersectsNoneOf(mustNot)) return;
    throw new InvalidQueryError(
      "must_have_tags and must_not_have_tags share at least one tag (the query would never match)",
      { field: "must_have_tags" },
    );
  }
}
