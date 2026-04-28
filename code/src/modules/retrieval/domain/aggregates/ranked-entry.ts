import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";
import type { NonEmptyString } from "../../../../shared/domain/value-objects/non-empty-string.ts";
import type { Tags } from "../../../../shared/domain/value-objects/tags.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { BM25Score } from "../value-objects/bm25-score.ts";
import type { CosineScore } from "../value-objects/cosine-score.ts";
import type { QueryKind } from "../value-objects/query-kind.ts";
import type { RelevanceScore } from "../value-objects/relevance-score.ts";

/**
 * Lightweight value object representing one row of a `mem.recall`
 * result list.
 *
 * Mirrors the `MemoryEntry` shape documented in
 * `docs/02-protocolo-mcp.md` §4.3:
 * ```
 * type MemoryEntry = {
 *   id: string;
 *   kind: Kind;
 *   content: string;
 *   metadata: Record<string, any>;
 *   score: number;
 *   created_at: number;
 *   last_used_ms: number;
 *   tags: string[];
 * };
 * ```
 *
 * The domain version drops the `metadata` free-form blob (the
 * application layer stitches it from the underlying aggregate at
 * serialisation time) and adds the per-component scores so the audit
 * log can record *why* each entry made the cut.
 *
 * This VO is intentionally a value object, not an aggregate: a recall
 * result is an ephemeral query output, not something with identity that
 * the rest of the domain mutates. The `aggregates/` directory hosts it
 * because it ships alongside `RecallResult` (the only aggregate-style
 * output of the recall pipeline) and because `RecallResult` references
 * it directly.
 *
 * Invariants:
 * - `id` is a non-empty string. Validated at the VO level rather than
 *   typed (`DecisionId | LearningId | ...`) so the same ranked entry
 *   shape can carry every kind without a type parameter; the kind is
 *   already the discriminator.
 * - `title` and `preview` are non-empty after trimming.
 * - `bm25Score` is `null` when the entry was retrieved by vector
 *   search alone; `cosineScore` is `null` when retrieved by FTS5 alone
 *   or when the entry's vector is not yet ready
 *   (`docs/01-arquitectura.md` §2.7 fallback).
 * - `relevanceScore` is non-null and reflects the final hybrid score.
 * - Instances are immutable.
 *
 * Equality:
 * - Two `RankedEntry` are equal iff `kind` and `id` match.
 */
export class RankedEntry {
  private constructor(
    public readonly kind: QueryKind,
    public readonly id: string,
    public readonly title: NonEmptyString,
    public readonly preview: NonEmptyString,
    public readonly tags: Tags,
    public readonly relevanceScore: RelevanceScore,
    public readonly bm25Score: BM25Score | null,
    public readonly cosineScore: CosineScore | null,
    public readonly createdAt: Timestamp,
    public readonly lastUsedAt: Timestamp | null,
  ) {}

  public static of(input: {
    kind: QueryKind;
    id: string;
    title: NonEmptyString;
    preview: NonEmptyString;
    tags: Tags;
    relevanceScore: RelevanceScore;
    bm25Score: BM25Score | null;
    cosineScore: CosineScore | null;
    createdAt: Timestamp;
    lastUsedAt: Timestamp | null;
  }): RankedEntry {
    if (typeof input.id !== "string" || input.id.trim().length === 0) {
      throw new InvalidInputError("ranked entry id must be a non-empty string", {
        field: "id",
      });
    }
    return new RankedEntry(
      input.kind,
      input.id,
      input.title,
      input.preview,
      input.tags,
      input.relevanceScore,
      input.bm25Score,
      input.cosineScore,
      input.createdAt,
      input.lastUsedAt,
    );
  }

  /**
   * True iff this entry was scored on both lexical and semantic
   * signals. Useful for audit/explanation paths.
   */
  public isHybridScored(): boolean {
    return this.bm25Score !== null && this.cosineScore !== null;
  }

  public equals(other: RankedEntry): boolean {
    if (this === other) return true;
    return this.kind.equals(other.kind) && this.id === other.id;
  }
}
