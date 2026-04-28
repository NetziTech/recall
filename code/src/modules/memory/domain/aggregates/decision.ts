import type { DomainEvent } from "../../../../shared/domain/types/domain-event.ts";
import type { Confidence } from "../../../../shared/domain/value-objects/confidence.ts";
import type { Tags } from "../../../../shared/domain/value-objects/tags.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import { DecisionNotActiveError } from "../errors/decision-not-active-error.ts";
import { DecisionSelfSupersessionError } from "../errors/decision-self-supersession-error.ts";
import { DecisionRecorded } from "../events/decision-recorded.ts";
import { DecisionSuperseded } from "../events/decision-superseded.ts";
import { DecisionUsed } from "../events/decision-used.ts";
import type { DecisionId } from "../value-objects/decision-id.ts";
import { DecisionStatus } from "../value-objects/decision-status.ts";
import type { DecisionTitle } from "../value-objects/decision-title.ts";
import type { EmbeddingStatus } from "../value-objects/embedding-status.ts";
import { LastUsed } from "../value-objects/last-used.ts";
import type { Rationale } from "../value-objects/rationale.ts";
import type { Scope } from "../value-objects/scope.ts";
import type { SessionId } from "../value-objects/session-id.ts";
import { SupersededBy } from "../value-objects/superseded-by.ts";
import { UseCount } from "../value-objects/use-count.ts";

/**
 * Aggregate root for the `Decision` kind of memory entry.
 *
 * Mirrors the `decisions` table documented in
 * `docs/03-modelo-datos.md` §4.3 with one important behavioural rule:
 * decisions are NEVER deleted. They live forever in the active set
 * until a newer decision supersedes them, at which point they are
 * filtered out from default recall (`docs/02-protocolo-mcp.md` §4.3 —
 * `include_superseded: false` by default). The `supersede` mutation is
 * therefore the only way to "retire" a decision.
 *
 * Invariants:
 * - Identity is immutable: `getId()` is stable for the entire lifetime.
 * - `status === "superseded"` implies `supersededBy !== null`. Both
 *   fields move together; the aggregate refuses partial states.
 * - A decision can only be superseded once. Once `status === "superseded"`,
 *   any further supersedes attempt raises `DecisionNotActiveError`.
 * - A decision cannot supersede itself.
 * - `useCount` is monotonic: it only grows via `markUsed`. The
 *   underlying VO refuses negative deltas.
 *
 * Persistence note:
 * - The `searchable_text` for embeddings is `title + "\n" + rationale`
 *   (`docs/03-modelo-datos.md` §5). The embedder watcher rebuilds the
 *   vector when it sees `embeddingStatus === "pending"`; the aggregate
 *   does NOT recompute it, since that work happens in infrastructure.
 */
export class Decision {
  private readonly id: DecisionId;
  private readonly workspaceId: WorkspaceId;
  /**
   * Session that captured the decision, or `null` when the decision
   * was recorded without an active session (e.g. an out-of-band CLI
   * import or a script-driven seed). The `decisions` table in
   * `docs/03-modelo-datos.md` §4.3 does not yet declare a
   * `session_id` column; until the schema gains the slot, the
   * persistence adapter is responsible for projecting this field into
   * `metadata_json` (or for ignoring it). Modelling the optionality
   * in the domain keeps the door open for the curator to retroactively
   * link decisions to their originating session when the schema
   * catches up, without forcing a refactor.
   */
  private readonly sessionId: SessionId | null;
  private readonly title: DecisionTitle;
  private readonly rationale: Rationale;
  private readonly tags: Tags;
  private status: DecisionStatus;
  private supersededBy: SupersededBy | null;
  private readonly confidence: Confidence;
  private useCount: UseCount;
  private lastUsed: LastUsed;
  private readonly scope: Scope;
  private readonly embeddingStatus: EmbeddingStatus;
  private readonly createdAt: Timestamp;
  private updatedAt: Timestamp;
  private readonly events: DomainEvent[];

  private constructor(input: {
    id: DecisionId;
    workspaceId: WorkspaceId;
    sessionId: SessionId | null;
    title: DecisionTitle;
    rationale: Rationale;
    tags: Tags;
    status: DecisionStatus;
    supersededBy: SupersededBy | null;
    confidence: Confidence;
    useCount: UseCount;
    lastUsed: LastUsed;
    scope: Scope;
    embeddingStatus: EmbeddingStatus;
    createdAt: Timestamp;
    updatedAt: Timestamp;
    events: readonly DomainEvent[];
  }) {
    this.id = input.id;
    this.workspaceId = input.workspaceId;
    this.sessionId = input.sessionId;
    this.title = input.title;
    this.rationale = input.rationale;
    this.tags = input.tags;
    this.status = input.status;
    this.supersededBy = input.supersededBy;
    this.confidence = input.confidence;
    this.useCount = input.useCount;
    this.lastUsed = input.lastUsed;
    this.scope = input.scope;
    this.embeddingStatus = input.embeddingStatus;
    this.createdAt = input.createdAt;
    this.updatedAt = input.updatedAt;
    this.events = [...input.events];
  }

  // -- factories -----------------------------------------------------------

  /**
   * Brings a brand-new `Decision` into existence. Use this exactly once
   * per decision id, when the application layer has decided the entry
   * does not yet exist.
   *
   * Defaults follow `docs/03-modelo-datos.md` §4.3:
   * - status: `active` (no `superseded_by`).
   * - confidence: `1.0` (full).
   * - useCount: `0`.
   * - lastUsed: `never` (the persistence layer translates this to
   *   `last_used_ms = created_at_ms` on disk).
   * - embeddingStatus: `pending` (the queue worker fills the vector
   *   asynchronously, per `docs/01-arquitectura.md` §2.7).
   *
   * Emits `DecisionRecorded`.
   */
  public static record(input: {
    id: DecisionId;
    workspaceId: WorkspaceId;
    sessionId: SessionId | null;
    title: DecisionTitle;
    rationale: Rationale;
    tags: Tags;
    confidence: Confidence;
    scope: Scope;
    embeddingStatus: EmbeddingStatus;
    occurredAt: Timestamp;
  }): Decision {
    const event = new DecisionRecorded({
      workspaceId: input.workspaceId,
      decisionId: input.id,
      occurredAt: input.occurredAt,
    });
    return new Decision({
      id: input.id,
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      title: input.title,
      rationale: input.rationale,
      tags: input.tags,
      status: DecisionStatus.active(),
      supersededBy: null,
      confidence: input.confidence,
      useCount: UseCount.zero(),
      lastUsed: LastUsed.never(),
      scope: input.scope,
      embeddingStatus: input.embeddingStatus,
      createdAt: input.occurredAt,
      updatedAt: input.occurredAt,
      events: [event],
    });
  }

  /**
   * Rehydrates a `Decision` from previously-persisted state. Does NOT
   * emit any event (no business fact is happening).
   */
  public static rehydrate(input: {
    id: DecisionId;
    workspaceId: WorkspaceId;
    sessionId: SessionId | null;
    title: DecisionTitle;
    rationale: Rationale;
    tags: Tags;
    status: DecisionStatus;
    supersededBy: SupersededBy | null;
    confidence: Confidence;
    useCount: UseCount;
    lastUsed: LastUsed;
    scope: Scope;
    embeddingStatus: EmbeddingStatus;
    createdAt: Timestamp;
    updatedAt: Timestamp;
  }): Decision {
    return new Decision({
      id: input.id,
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      title: input.title,
      rationale: input.rationale,
      tags: input.tags,
      status: input.status,
      supersededBy: input.supersededBy,
      confidence: input.confidence,
      useCount: input.useCount,
      lastUsed: input.lastUsed,
      scope: input.scope,
      embeddingStatus: input.embeddingStatus,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
      events: [],
    });
  }

  // -- mutations -----------------------------------------------------------

  /**
   * Marks the decision as superseded by a newer one.
   *
   * Refuses:
   * - self-supersession (`successorId === this.id`);
   * - re-supersession (the decision is already `superseded`).
   *
   * Emits `DecisionSuperseded`.
   */
  public supersede(input: {
    successorId: DecisionId;
    occurredAt: Timestamp;
  }): void {
    if (input.successorId.equals(this.id)) {
      throw new DecisionSelfSupersessionError(this.id);
    }
    if (this.status.isSuperseded()) {
      throw new DecisionNotActiveError(this.id);
    }
    this.status = DecisionStatus.superseded();
    this.supersededBy = SupersededBy.of(input.successorId);
    this.updatedAt = input.occurredAt;
    this.events.push(
      new DecisionSuperseded({
        workspaceId: this.workspaceId,
        previousDecisionId: this.id,
        successorDecisionId: input.successorId,
        occurredAt: input.occurredAt,
      }),
    );
  }

  /**
   * Records a use (recall hit, context-bundle inclusion, ...). Bumps
   * `useCount` and refreshes `lastUsed`. Emits `DecisionUsed`.
   *
   * The aggregate accepts marking *superseded* decisions as used too:
   * a recall query with `include_superseded: true` may surface an old
   * decision intentionally, and the bookkeeping should still reflect
   * that it was looked at.
   */
  public markUsed(input: { occurredAt: Timestamp }): void {
    this.useCount = this.useCount.increment();
    this.lastUsed = this.lastUsed.touch(input.occurredAt);
    this.updatedAt = input.occurredAt;
    this.events.push(
      new DecisionUsed({
        workspaceId: this.workspaceId,
        decisionId: this.id,
        occurredAt: input.occurredAt,
      }),
    );
  }

  // -- queries -------------------------------------------------------------

  public getId(): DecisionId {
    return this.id;
  }

  public getWorkspaceId(): WorkspaceId {
    return this.workspaceId;
  }

  public getSessionId(): SessionId | null {
    return this.sessionId;
  }

  public getTitle(): DecisionTitle {
    return this.title;
  }

  public getRationale(): Rationale {
    return this.rationale;
  }

  public getTags(): Tags {
    return this.tags;
  }

  public getStatus(): DecisionStatus {
    return this.status;
  }

  public getSupersededBy(): SupersededBy | null {
    return this.supersededBy;
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

  public getCreatedAt(): Timestamp {
    return this.createdAt;
  }

  public getUpdatedAt(): Timestamp {
    return this.updatedAt;
  }

  public isActive(): boolean {
    return this.status.isActive();
  }

  /**
   * Drains and returns the buffered events. Mirrors the workspace
   * aggregate's contract.
   */
  public pullEvents(): readonly DomainEvent[] {
    if (this.events.length === 0) return Object.freeze([]);
    const drained = this.events.slice();
    this.events.length = 0;
    return Object.freeze(drained);
  }
}
