import type { DomainEvent } from "../../../../shared/domain/types/domain-event.ts";
import type { Confidence } from "../../../../shared/domain/value-objects/confidence.ts";
import type { Tags } from "../../../../shared/domain/value-objects/tags.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import { TurnRecorded } from "../events/turn-recorded.ts";
import { TurnUsed } from "../events/turn-used.ts";
import type { FilesTouched } from "../value-objects/files-touched.ts";
import { LastUsed } from "../value-objects/last-used.ts";
import type { LinkedDecisionIds } from "../value-objects/linked-decision-ids.ts";
import type { LinkedLearningIds } from "../value-objects/linked-learning-ids.ts";
import type { SessionId } from "../value-objects/session-id.ts";
import type { TurnId } from "../value-objects/turn-id.ts";
import type { TurnIntent } from "../value-objects/turn-intent.ts";
import type { TurnOutcome } from "../value-objects/turn-outcome.ts";
import type { TurnSummary } from "../value-objects/turn-summary.ts";
import { UseCount } from "../value-objects/use-count.ts";

/**
 * Aggregate root for the `Turn` kind of memory entry.
 *
 * Mirrors the `turns` table documented in `docs/03-modelo-datos.md`
 * §4.2 in full. The aggregate carries every persisted column so the
 * recall and decay paths (Capa 4 — Recent Turns,
 * `docs/04-capas-contexto.md` §3.4; Capa 5 — Relevant Memory,
 * `docs/04-capas-contexto.md` §3.5) can rank turns by `confidence ×
 * recency × use_count` and join on `intent + outcome` for the
 * embedder searchable_text (`docs/03-modelo-datos.md` §5).
 *
 * A turn is conceptually a historical record: the body (`summary`,
 * `intent`, `outcome`, `filesTouched`, `linkedDecisions`,
 * `linkedLearnings`, `tags`) is fixed once `record(...)` is called.
 * The only mutable fields are the recall-bookkeeping counters
 * (`useCount`, `lastUsed`, `confidence`): the curator decays
 * confidence over time, recall hits bump `useCount` and `lastUsed`.
 *
 * Invariants:
 * - Identity is immutable.
 * - The body fields (summary, intent, outcome, filesTouched, linked*,
 *   tags) are read-only after construction.
 * - `useCount` is monotonic.
 * - `confidence` lives in the closed interval [0, 1] and is updated
 *   by the curator via decay; the aggregate exposes a clean
 *   `applyDecay(...)` mutation rather than letting the curator poke
 *   the field.
 */
export class Turn {
  private readonly id: TurnId;
  private readonly workspaceId: WorkspaceId;
  private readonly sessionId: SessionId;
  private readonly summary: TurnSummary;
  private readonly intent: TurnIntent | null;
  private readonly outcome: TurnOutcome | null;
  private readonly filesTouched: FilesTouched;
  private readonly linkedDecisions: LinkedDecisionIds;
  private readonly linkedLearnings: LinkedLearningIds;
  private readonly tags: Tags;
  private confidence: Confidence;
  private useCount: UseCount;
  private lastUsed: LastUsed;
  private readonly createdAt: Timestamp;
  private readonly events: DomainEvent[];

  private constructor(input: {
    id: TurnId;
    workspaceId: WorkspaceId;
    sessionId: SessionId;
    summary: TurnSummary;
    intent: TurnIntent | null;
    outcome: TurnOutcome | null;
    filesTouched: FilesTouched;
    linkedDecisions: LinkedDecisionIds;
    linkedLearnings: LinkedLearningIds;
    tags: Tags;
    confidence: Confidence;
    useCount: UseCount;
    lastUsed: LastUsed;
    createdAt: Timestamp;
    events: readonly DomainEvent[];
  }) {
    this.id = input.id;
    this.workspaceId = input.workspaceId;
    this.sessionId = input.sessionId;
    this.summary = input.summary;
    this.intent = input.intent;
    this.outcome = input.outcome;
    this.filesTouched = input.filesTouched;
    this.linkedDecisions = input.linkedDecisions;
    this.linkedLearnings = input.linkedLearnings;
    this.tags = input.tags;
    this.confidence = input.confidence;
    this.useCount = input.useCount;
    this.lastUsed = input.lastUsed;
    this.createdAt = input.createdAt;
    this.events = [...input.events];
  }

  // -- factories -----------------------------------------------------------

  /**
   * Brings a brand-new `Turn` into existence. Emits `TurnRecorded`.
   *
   * Defaults follow `docs/03-modelo-datos.md` §4.2:
   * - confidence: full (1.0).
   * - useCount: zero.
   * - lastUsed: never (the persistence layer translates this to
   *   `last_used_ms = recorded_at_ms` on disk, mirroring the column
   *   default).
   */
  public static record(input: {
    id: TurnId;
    workspaceId: WorkspaceId;
    sessionId: SessionId;
    summary: TurnSummary;
    intent: TurnIntent | null;
    outcome: TurnOutcome | null;
    filesTouched: FilesTouched;
    linkedDecisions: LinkedDecisionIds;
    linkedLearnings: LinkedLearningIds;
    tags: Tags;
    confidence: Confidence;
    occurredAt: Timestamp;
  }): Turn {
    const event = new TurnRecorded({
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      turnId: input.id,
      occurredAt: input.occurredAt,
    });
    return new Turn({
      id: input.id,
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      summary: input.summary,
      intent: input.intent,
      outcome: input.outcome,
      filesTouched: input.filesTouched,
      linkedDecisions: input.linkedDecisions,
      linkedLearnings: input.linkedLearnings,
      tags: input.tags,
      confidence: input.confidence,
      useCount: UseCount.zero(),
      lastUsed: LastUsed.never(),
      createdAt: input.occurredAt,
      events: [event],
    });
  }

  /**
   * Rehydrates a `Turn` from previously-persisted state. Does NOT
   * emit any event.
   */
  public static rehydrate(input: {
    id: TurnId;
    workspaceId: WorkspaceId;
    sessionId: SessionId;
    summary: TurnSummary;
    intent: TurnIntent | null;
    outcome: TurnOutcome | null;
    filesTouched: FilesTouched;
    linkedDecisions: LinkedDecisionIds;
    linkedLearnings: LinkedLearningIds;
    tags: Tags;
    confidence: Confidence;
    useCount: UseCount;
    lastUsed: LastUsed;
    createdAt: Timestamp;
  }): Turn {
    return new Turn({
      id: input.id,
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      summary: input.summary,
      intent: input.intent,
      outcome: input.outcome,
      filesTouched: input.filesTouched,
      linkedDecisions: input.linkedDecisions,
      linkedLearnings: input.linkedLearnings,
      tags: input.tags,
      confidence: input.confidence,
      useCount: input.useCount,
      lastUsed: input.lastUsed,
      createdAt: input.createdAt,
      events: [],
    });
  }

  // -- mutations -----------------------------------------------------------

  /**
   * Records a use (recall hit, context-bundle inclusion, ...). Bumps
   * `useCount` and refreshes `lastUsed`. Emits `TurnUsed`.
   *
   * The curator's decay pass and the recall scorer both rely on these
   * counters; without them Capa 4 (Recent Turns) cannot rank by
   * `recency × confidence × use_count`.
   */
  public markUsed(input: { occurredAt: Timestamp }): void {
    this.useCount = this.useCount.increment();
    this.lastUsed = this.lastUsed.touch(input.occurredAt);
    this.events.push(
      new TurnUsed({
        workspaceId: this.workspaceId,
        sessionId: this.sessionId,
        turnId: this.id,
        occurredAt: input.occurredAt,
      }),
    );
  }

  /**
   * Applies the curator's decay factor to the turn's confidence.
   * Mirrors the multiplicative decay defined in
   * `docs/03-modelo-datos.md` §2 (`curator.decay_factor: 0.95`) and
   * the rapid-decay rule for turns
   * (`docs/04-capas-contexto.md` §3.4 — "Decay rapido. confidence
   * baja 0.05 por dia"). The aggregate does NOT emit an event for
   * decay because the curator emits its own `CuratorRunCompleted`
   * higher up; emitting per-turn events would flood the bus.
   */
  public applyDecay(factor: number): void {
    this.confidence = this.confidence.decay(factor);
  }

  // -- queries -------------------------------------------------------------

  public getId(): TurnId {
    return this.id;
  }

  public getWorkspaceId(): WorkspaceId {
    return this.workspaceId;
  }

  public getSessionId(): SessionId {
    return this.sessionId;
  }

  public getSummary(): TurnSummary {
    return this.summary;
  }

  public getIntent(): TurnIntent | null {
    return this.intent;
  }

  public getOutcome(): TurnOutcome | null {
    return this.outcome;
  }

  public getFilesTouched(): FilesTouched {
    return this.filesTouched;
  }

  public getLinkedDecisions(): LinkedDecisionIds {
    return this.linkedDecisions;
  }

  public getLinkedLearnings(): LinkedLearningIds {
    return this.linkedLearnings;
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

  public getCreatedAt(): Timestamp {
    return this.createdAt;
  }

  public pullEvents(): readonly DomainEvent[] {
    if (this.events.length === 0) return Object.freeze([]);
    const drained = this.events.slice();
    this.events.length = 0;
    return Object.freeze(drained);
  }
}
