import type { Confidence } from "../../../../shared/domain/value-objects/confidence.ts";
import type { Tags } from "../../../../shared/domain/value-objects/tags.ts";
import type { DecisionId } from "../../../memory/domain/value-objects/decision-id.ts";
import type { DecisionTitle } from "../../../memory/domain/value-objects/decision-title.ts";
import type { Scope } from "../../../memory/domain/value-objects/scope.ts";
import type { RelevanceScore } from "./relevance-score.ts";

/**
 * Lightweight reference to a `Decision` aggregate, suitable for
 * inclusion in a `ContextBundle` layer.
 *
 * The retrieval layer refuses to leak whole `Decision` aggregates into
 * the bundle: the bundle is a *presentation projection* used by the
 * MCP transport, and embedding the aggregate would (a) double the
 * working set in memory, (b) couple the bundle's serialisation to the
 * full Decision schema (rationale text, tags, scope, supersedeship,
 * ...), and (c) make every change to `Decision` ripple through the
 * retrieval bundle's wire format. The `*Ref` projections capture only
 * what the rendering needs and stay stable across schema evolutions of
 * the underlying aggregate.
 *
 * Fields are chosen against the doc's example bundle in
 * `docs/04-capas-contexto.md` §11 ("CAPA 2 — Project Constitution"):
 * each item shows the title and is grouped by scope. The relevance
 * score is included so the layer can be sorted; the confidence is the
 * curator's "freshness" signal.
 *
 * Invariants:
 * - All fields are value objects already validated by their own
 *   factories; the ref does not re-validate.
 * - Instances are immutable (`readonly` fields, `private constructor`).
 *
 * Equality:
 * - Two `DecisionRef` are equal iff their ids match. Other fields are
 *   denormalised projections and may legitimately drift across
 *   re-reads of the same decision (e.g. confidence after decay).
 */
export class DecisionRef {
  private constructor(
    public readonly id: DecisionId,
    public readonly title: DecisionTitle,
    public readonly tags: Tags,
    public readonly scope: Scope,
    public readonly confidence: Confidence,
    public readonly relevanceScore: RelevanceScore,
  ) {}

  public static of(input: {
    id: DecisionId;
    title: DecisionTitle;
    tags: Tags;
    scope: Scope;
    confidence: Confidence;
    relevanceScore: RelevanceScore;
  }): DecisionRef {
    return new DecisionRef(
      input.id,
      input.title,
      input.tags,
      input.scope,
      input.confidence,
      input.relevanceScore,
    );
  }

  public equals(other: DecisionRef): boolean {
    if (this === other) return true;
    return this.id.equals(other.id);
  }
}
