import type { Confidence } from "../../../../shared/domain/value-objects/confidence.ts";
import type { Tags } from "../../../../shared/domain/value-objects/tags.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import { InvalidRecallFiltersError } from "../errors/invalid-recall-filters-error.ts";
import type { QueryKind} from "./query-kind.ts";
import { type QueryKindValue } from "./query-kind.ts";

/**
 * Hard upper bound on the number of entries `mem.recall` is allowed to
 * return in one call. Mirrors `top_k` in `docs/02-protocolo-mcp.md`
 * §4.3 ("default 8") and the implicit ceiling that keeps the JSON-RPC
 * payload below the MCP message-size limit. Picked at 100 to leave
 * headroom for power users without letting a typo (`top_k: 10000`) DoS
 * the embedder.
 */
const MAX_RECALL_LIMIT = 100;

/**
 * Composite value object capturing the structural filters of a
 * `mem.recall` request — the parts that constrain *which* entries are
 * considered, separately from the textual query that drives the
 * scoring.
 *
 * Mirrors `docs/02-protocolo-mcp.md` §4.3:
 * ```
 * {
 *   kinds?: Kind[];
 *   must_have_tags?: string[];
 *   must_not_have_tags?: string[];
 *   since_ms?: number;        // mapped to `since: Timestamp | null`
 *   ...
 *   top_k?: number;           // mapped to `limit: number`
 * }
 * ```
 *
 * Plus two domain extensions:
 * - `minConfidence`: drop entries whose confidence is below the given
 *   threshold (the curator decay model in `docs/05-memoria-decay.md`
 *   makes `confidence` the canonical "fresh enough" signal). Optional.
 * - `until`: upper time bound, symmetric to `since`. Useful for
 *   "what was active around X" queries.
 *
 * Invariants:
 * - `kinds` is a frozen, deduplicated array.
 * - `since <= until` when both are present.
 * - `limit` is a positive integer ≤ `MAX_RECALL_LIMIT`.
 * - `mustHaveTags` and `mustNotHaveTags` MUST share no tag (a query
 *   that requires a tag and forbids it would always yield zero
 *   results).
 * - Instances are immutable.
 */
export class RecallFilters {
  private readonly kindValues: readonly QueryKind[];

  private constructor(
    kinds: readonly QueryKind[],
    public readonly tags: Tags,
    public readonly mustHaveTags: Tags,
    public readonly mustNotHaveTags: Tags,
    public readonly minConfidence: Confidence | null,
    public readonly since: Timestamp | null,
    public readonly until: Timestamp | null,
    public readonly limit: number,
  ) {
    this.kindValues = kinds;
  }

  /**
   * Builds a `RecallFilters` from value-object inputs.
   */
  public static create(input: {
    kinds: readonly QueryKind[];
    tags: Tags;
    mustHaveTags: Tags;
    mustNotHaveTags: Tags;
    minConfidence: Confidence | null;
    since: Timestamp | null;
    until: Timestamp | null;
    limit: number;
  }): RecallFilters {
    RecallFilters.assertLimit(input.limit);
    RecallFilters.assertTagFilterCoherence(
      input.mustHaveTags,
      input.mustNotHaveTags,
    );
    RecallFilters.assertTimeRange(input.since, input.until);
    const dedupedKinds = RecallFilters.dedupeKinds(input.kinds);
    return new RecallFilters(
      dedupedKinds,
      input.tags,
      input.mustHaveTags,
      input.mustNotHaveTags,
      input.minConfidence,
      input.since,
      input.until,
      input.limit,
    );
  }

  public getKinds(): readonly QueryKind[] {
    return this.kindValues;
  }

  public getKindValues(): readonly QueryKindValue[] {
    const out: QueryKindValue[] = [];
    for (const k of this.kindValues) {
      out.push(k.value);
    }
    return Object.freeze(out);
  }

  public hasNoKindFilter(): boolean {
    return this.kindValues.length === 0;
  }

  public equals(other: RecallFilters): boolean {
    if (this === other) return true;
    if (this.limit !== other.limit) return false;
    if (this.kindValues.length !== other.kindValues.length) return false;
    for (let i = 0; i < this.kindValues.length; i += 1) {
      const a = this.kindValues[i];
      const b = other.kindValues[i];
      if (a === undefined || b === undefined) return false;
      if (!a.equals(b)) return false;
    }
    if (!this.tags.equals(other.tags)) return false;
    if (!this.mustHaveTags.equals(other.mustHaveTags)) return false;
    if (!this.mustNotHaveTags.equals(other.mustNotHaveTags)) return false;
    if (
      (this.minConfidence === null) !== (other.minConfidence === null) ||
      (this.minConfidence !== null &&
        other.minConfidence !== null &&
        !this.minConfidence.equals(other.minConfidence))
    ) {
      return false;
    }
    if (
      (this.since === null) !== (other.since === null) ||
      (this.since !== null &&
        other.since !== null &&
        !this.since.equals(other.since))
    ) {
      return false;
    }
    if (
      (this.until === null) !== (other.until === null) ||
      (this.until !== null &&
        other.until !== null &&
        !this.until.equals(other.until))
    ) {
      return false;
    }
    return true;
  }

  // -- internals -----------------------------------------------------------

  private static assertLimit(limit: number): void {
    if (!Number.isFinite(limit)) {
      throw new InvalidRecallFiltersError("limit must be a finite number", {
        field: "limit",
      });
    }
    if (!Number.isInteger(limit)) {
      throw new InvalidRecallFiltersError("limit must be an integer", {
        field: "limit",
      });
    }
    if (limit <= 0) {
      throw new InvalidRecallFiltersError(
        `limit must be strictly positive (got: ${String(limit)})`,
        { field: "limit" },
      );
    }
    if (limit > MAX_RECALL_LIMIT) {
      throw new InvalidRecallFiltersError(
        `limit must be at most ${String(MAX_RECALL_LIMIT)} (got: ${String(limit)})`,
        { field: "limit" },
      );
    }
  }

  private static assertTagFilterCoherence(mustHave: Tags, mustNot: Tags): void {
    if (mustHave.isEmpty() || mustNot.isEmpty()) return;
    if (mustHave.intersectsNoneOf(mustNot)) return;
    throw new InvalidRecallFiltersError(
      "must_have_tags and must_not_have_tags share at least one tag (the filter would never match)",
      { field: "must_have_tags" },
    );
  }

  private static assertTimeRange(
    since: Timestamp | null,
    until: Timestamp | null,
  ): void {
    if (since === null || until === null) return;
    if (since.isAfter(until)) {
      throw new InvalidRecallFiltersError(
        "since must not be after until (the time range would be empty)",
        { field: "since" },
      );
    }
  }

  private static dedupeKinds(
    kinds: readonly QueryKind[],
  ): readonly QueryKind[] {
    const seen = new Set<string>();
    const out: QueryKind[] = [];
    for (const candidate of kinds) {
      if (seen.has(candidate.value)) continue;
      seen.add(candidate.value);
      out.push(candidate);
    }
    return Object.freeze(out);
  }
}
