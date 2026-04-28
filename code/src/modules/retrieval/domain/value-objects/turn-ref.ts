import type { Confidence } from "../../../../shared/domain/value-objects/confidence.ts";
import type { Tags } from "../../../../shared/domain/value-objects/tags.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { TurnId } from "../../../memory/domain/value-objects/turn-id.ts";
import type { TurnSummary } from "../../../memory/domain/value-objects/turn-summary.ts";
import type { RelevanceScore } from "./relevance-score.ts";

/**
 * Lightweight reference to a `Turn` aggregate, suitable for inclusion
 * in the `recent_turns` layer of a `ContextBundle`.
 *
 * Mirrors the doc's example bundle in `docs/04-capas-contexto.md` §3.4
 * ("Capa 4 — Recent Turns") which renders each turn as a one-line
 * summary. The ref carries:
 * - `id` — for deduplication across layers.
 * - `summary` — the renderable text (always present in `Turn`).
 * - `recordedAt` — used to sort the layer DESC and to compute the
 *   recency component when re-scoring.
 * - `confidence` — the curator's freshness signal, used to drop very
 *   old turns from the layer.
 * - `tags` — for tag-based filtering inside the layer.
 * - `relevanceScore` — final score from the hybrid scorer (when this
 *   turn surfaced through `relevant_memory` instead of plain "recent").
 *
 * The full `intent`, `outcome`, `filesTouched`, `linkedDecisions`,
 * `linkedLearnings` are omitted: the layer renders only the summary
 * (per the doc's example), and surfacing the rest would push past the
 * 800-token cap.
 *
 * Invariants:
 * - All fields are validated VOs.
 * - Instances are immutable.
 *
 * Equality:
 * - Two `TurnRef` are equal iff their ids match.
 */
export class TurnRef {
  private constructor(
    public readonly id: TurnId,
    public readonly summary: TurnSummary,
    public readonly recordedAt: Timestamp,
    public readonly confidence: Confidence,
    public readonly tags: Tags,
    public readonly relevanceScore: RelevanceScore,
  ) {}

  public static of(input: {
    id: TurnId;
    summary: TurnSummary;
    recordedAt: Timestamp;
    confidence: Confidence;
    tags: Tags;
    relevanceScore: RelevanceScore;
  }): TurnRef {
    return new TurnRef(
      input.id,
      input.summary,
      input.recordedAt,
      input.confidence,
      input.tags,
      input.relevanceScore,
    );
  }

  public equals(other: TurnRef): boolean {
    if (this === other) return true;
    return this.id.equals(other.id);
  }
}
