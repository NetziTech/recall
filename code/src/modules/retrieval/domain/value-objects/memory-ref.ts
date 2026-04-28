import type { Confidence } from "../../../../shared/domain/value-objects/confidence.ts";
import type { Tags } from "../../../../shared/domain/value-objects/tags.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { NonEmptyString } from "../../../../shared/domain/value-objects/non-empty-string.ts";
import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";
import type { QueryKind } from "./query-kind.ts";
import type { RelevanceScore } from "./relevance-score.ts";

/**
 * Lightweight reference to ANY kind of memory entry, suitable for
 * inclusion in the `relevant_memory` layer of a `ContextBundle`.
 *
 * The `relevant_memory` layer (`docs/04-capas-contexto.md` §3.5) is the
 * "free-form hybrid search result" layer: it can carry decisions,
 * learnings, entities, turns — anything that scored well against the
 * query. Carrying a typed `DecisionRef | LearningRef | EntityRef |
 * TurnRef` union here would force the bundle assembler to pattern-match
 * on every entry; instead, this projection collapses the kind into a
 * `QueryKind` discriminator and exposes only the renderable fields
 * (`title` + a short `preview`).
 *
 * Modelling decision — the typed `*Ref` VOs vs `MemoryRef`:
 * - `DecisionRef`, `TaskRef`, `TurnRef`, `EntityRef`, `OpenQuestionRef`
 *   live in the *typed* layers (`active_decisions`, `open_tasks`, ...)
 *   where the layer's identity is "this layer holds X-shaped things".
 * - `MemoryRef` lives in the `relevant_memory` layer where the layer's
 *   identity is "things related to the query, regardless of kind".
 *
 * Invariants:
 * - `kind` discriminates the original aggregate kind.
 * - `id` is the underlying aggregate's id, stored as a string so this
 *   ref can carry decisions, learnings, entities, ... without a type
 *   parameter. Validated as a non-empty trimmed string in the factory
 *   to mirror the discipline of `RankedEntry.of(...)` and to prevent
 *   malformed refs from breaking cross-layer dedup in the bundle
 *   assembler (`docs/04-capas-contexto.md` §4) or violating the
 *   non-empty `id` contract of the JSON-RPC `MemoryEntry` payload
 *   (`docs/02-protocolo-mcp.md` §4.3).
 * - `title` and `preview` are non-empty after trimming (enforced by
 *   `NonEmptyString`).
 * - Instances are immutable.
 *
 * Equality:
 * - Two `MemoryRef` are equal iff `kind` and `id` match. Other fields
 *   are presentation projections.
 */
export class MemoryRef {
  private constructor(
    public readonly kind: QueryKind,
    public readonly id: string,
    public readonly title: NonEmptyString,
    public readonly preview: NonEmptyString,
    public readonly tags: Tags,
    public readonly confidence: Confidence,
    public readonly lastUsedAt: Timestamp | null,
    public readonly relevanceScore: RelevanceScore,
  ) {}

  public static of(input: {
    kind: QueryKind;
    id: string;
    title: NonEmptyString;
    preview: NonEmptyString;
    tags: Tags;
    confidence: Confidence;
    lastUsedAt: Timestamp | null;
    relevanceScore: RelevanceScore;
  }): MemoryRef {
    if (typeof input.id !== "string" || input.id.trim().length === 0) {
      throw new InvalidInputError("memory ref id must be a non-empty string", {
        field: "id",
      });
    }
    return new MemoryRef(
      input.kind,
      input.id,
      input.title,
      input.preview,
      input.tags,
      input.confidence,
      input.lastUsedAt,
      input.relevanceScore,
    );
  }

  public equals(other: MemoryRef): boolean {
    if (this === other) return true;
    return this.kind.equals(other.kind) && this.id === other.id;
  }
}
