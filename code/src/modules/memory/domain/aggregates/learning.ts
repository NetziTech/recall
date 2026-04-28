import type { DomainEvent } from "../../../../shared/domain/types/domain-event.ts";
import type { Confidence } from "../../../../shared/domain/value-objects/confidence.ts";
import type { Tags } from "../../../../shared/domain/value-objects/tags.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import { LearningAlreadyConsolidatedError } from "../errors/learning-already-consolidated-error.ts";
import { LearningSelfConsolidationError } from "../errors/learning-self-consolidation-error.ts";
import { LearningConsolidated } from "../events/learning-consolidated.ts";
import { LearningRegistered } from "../events/learning-registered.ts";
import { LearningUsed } from "../events/learning-used.ts";
import type { EmbeddingStatus } from "../value-objects/embedding-status.ts";
import { LastUsed } from "../value-objects/last-used.ts";
import type { LearningId } from "../value-objects/learning-id.ts";
import type { LearningSeverity } from "../value-objects/learning-severity.ts";
import type { LearningText } from "../value-objects/learning-text.ts";
import type { Scope } from "../value-objects/scope.ts";
import { UseCount } from "../value-objects/use-count.ts";

/**
 * Aggregate root for the `Learning` kind of memory entry.
 *
 * Mirrors the `learnings` table documented in
 * `docs/03-modelo-datos.md` §4.4. A learning is a short observation
 * the assistant captured while working ("siempre canonicalizar paths
 * antes de comparar"). The curator periodically runs a consolidation
 * pass to fold semantically-equivalent learnings into a single
 * canonical entry; the consolidated ones are kept for audit (and to
 * keep stable pointers) but excluded from active recall.
 *
 * Invariants:
 * - Identity is immutable.
 * - A learning can only be consolidated once. The presence of
 *   `consolidatedInto !== null` is the audit-trail marker; the
 *   aggregate refuses to overwrite it.
 * - A learning cannot be consolidated into itself.
 * - `useCount` is monotonic.
 */
export class Learning {
  private readonly id: LearningId;
  private readonly workspaceId: WorkspaceId;
  private readonly text: LearningText;
  private readonly severity: LearningSeverity;
  private readonly tags: Tags;
  private readonly confidence: Confidence;
  private useCount: UseCount;
  private lastUsed: LastUsed;
  private readonly scope: Scope;
  private readonly embeddingStatus: EmbeddingStatus;
  private consolidatedInto: LearningId | null;
  private readonly createdAt: Timestamp;
  private updatedAt: Timestamp;
  private readonly events: DomainEvent[];

  private constructor(input: {
    id: LearningId;
    workspaceId: WorkspaceId;
    text: LearningText;
    severity: LearningSeverity;
    tags: Tags;
    confidence: Confidence;
    useCount: UseCount;
    lastUsed: LastUsed;
    scope: Scope;
    embeddingStatus: EmbeddingStatus;
    consolidatedInto: LearningId | null;
    createdAt: Timestamp;
    updatedAt: Timestamp;
    events: readonly DomainEvent[];
  }) {
    this.id = input.id;
    this.workspaceId = input.workspaceId;
    this.text = input.text;
    this.severity = input.severity;
    this.tags = input.tags;
    this.confidence = input.confidence;
    this.useCount = input.useCount;
    this.lastUsed = input.lastUsed;
    this.scope = input.scope;
    this.embeddingStatus = input.embeddingStatus;
    this.consolidatedInto = input.consolidatedInto;
    this.createdAt = input.createdAt;
    this.updatedAt = input.updatedAt;
    this.events = [...input.events];
  }

  // -- factories -----------------------------------------------------------

  /**
   * Brings a brand-new `Learning` into existence. Emits
   * `LearningRegistered`.
   */
  public static register(input: {
    id: LearningId;
    workspaceId: WorkspaceId;
    text: LearningText;
    severity: LearningSeverity;
    tags: Tags;
    confidence: Confidence;
    scope: Scope;
    embeddingStatus: EmbeddingStatus;
    occurredAt: Timestamp;
  }): Learning {
    const event = new LearningRegistered({
      workspaceId: input.workspaceId,
      learningId: input.id,
      occurredAt: input.occurredAt,
    });
    return new Learning({
      id: input.id,
      workspaceId: input.workspaceId,
      text: input.text,
      severity: input.severity,
      tags: input.tags,
      confidence: input.confidence,
      useCount: UseCount.zero(),
      lastUsed: LastUsed.never(),
      scope: input.scope,
      embeddingStatus: input.embeddingStatus,
      consolidatedInto: null,
      createdAt: input.occurredAt,
      updatedAt: input.occurredAt,
      events: [event],
    });
  }

  /**
   * Rehydrates a `Learning` from previously-persisted state. Does NOT
   * emit any event.
   */
  public static rehydrate(input: {
    id: LearningId;
    workspaceId: WorkspaceId;
    text: LearningText;
    severity: LearningSeverity;
    tags: Tags;
    confidence: Confidence;
    useCount: UseCount;
    lastUsed: LastUsed;
    scope: Scope;
    embeddingStatus: EmbeddingStatus;
    consolidatedInto: LearningId | null;
    createdAt: Timestamp;
    updatedAt: Timestamp;
  }): Learning {
    return new Learning({
      id: input.id,
      workspaceId: input.workspaceId,
      text: input.text,
      severity: input.severity,
      tags: input.tags,
      confidence: input.confidence,
      useCount: input.useCount,
      lastUsed: input.lastUsed,
      scope: input.scope,
      embeddingStatus: input.embeddingStatus,
      consolidatedInto: input.consolidatedInto,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
      events: [],
    });
  }

  // -- mutations -----------------------------------------------------------

  /**
   * Records a use. Mirrors `Decision.markUsed` for the learning kind.
   */
  public markUsed(input: { occurredAt: Timestamp }): void {
    this.useCount = this.useCount.increment();
    this.lastUsed = this.lastUsed.touch(input.occurredAt);
    this.updatedAt = input.occurredAt;
    this.events.push(
      new LearningUsed({
        workspaceId: this.workspaceId,
        learningId: this.id,
        occurredAt: input.occurredAt,
      }),
    );
  }

  /**
   * Folds this learning into another one (canonical target). Refuses:
   * - self-consolidation (`targetId === this.id`);
   * - re-consolidation (the learning was already folded).
   *
   * Emits `LearningConsolidated`.
   */
  public consolidateInto(input: {
    targetId: LearningId;
    occurredAt: Timestamp;
  }): void {
    if (input.targetId.equals(this.id)) {
      throw new LearningSelfConsolidationError(this.id);
    }
    if (this.consolidatedInto !== null) {
      throw new LearningAlreadyConsolidatedError(this.id);
    }
    this.consolidatedInto = input.targetId;
    this.updatedAt = input.occurredAt;
    this.events.push(
      new LearningConsolidated({
        workspaceId: this.workspaceId,
        consolidatedLearningId: this.id,
        targetLearningId: input.targetId,
        occurredAt: input.occurredAt,
      }),
    );
  }

  // -- queries -------------------------------------------------------------

  public getId(): LearningId {
    return this.id;
  }

  public getWorkspaceId(): WorkspaceId {
    return this.workspaceId;
  }

  public getText(): LearningText {
    return this.text;
  }

  public getSeverity(): LearningSeverity {
    return this.severity;
  }

  public getTags(): Tags {
    return this.tags;
  }

  public getConfidence(): Confidence {
    return this.confidence;
  }

  public getUseCount(): UseCount {
    return this.useCount;
  }

  public getLastUsed(): LastUsed {
    return this.lastUsed;
  }

  public getScope(): Scope {
    return this.scope;
  }

  public getEmbeddingStatus(): EmbeddingStatus {
    return this.embeddingStatus;
  }

  public getConsolidatedInto(): LearningId | null {
    return this.consolidatedInto;
  }

  public getCreatedAt(): Timestamp {
    return this.createdAt;
  }

  public getUpdatedAt(): Timestamp {
    return this.updatedAt;
  }

  public isActive(): boolean {
    return this.consolidatedInto === null;
  }

  public pullEvents(): readonly DomainEvent[] {
    if (this.events.length === 0) return Object.freeze([]);
    const drained = this.events.slice();
    this.events.length = 0;
    return Object.freeze(drained);
  }
}
