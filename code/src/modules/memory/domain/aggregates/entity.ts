import type { DomainEvent } from "../../../../shared/domain/types/domain-event.ts";
import type { Confidence } from "../../../../shared/domain/value-objects/confidence.ts";
import type { Tags } from "../../../../shared/domain/value-objects/tags.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import { EntityDescribed } from "../events/entity-described.ts";
import { EntityRegistered } from "../events/entity-registered.ts";
import { EntityUsed } from "../events/entity-used.ts";
import { EmbeddingStatus } from "../value-objects/embedding-status.ts";
import { EntityDescription } from "../value-objects/entity-description.ts";
import type { EntityId } from "../value-objects/entity-id.ts";
import type { EntityKind } from "../value-objects/entity-kind.ts";
import type { EntityName } from "../value-objects/entity-name.ts";
import { LastUsed } from "../value-objects/last-used.ts";
import type { Scope } from "../value-objects/scope.ts";
import { UseCount } from "../value-objects/use-count.ts";

/**
 * Aggregate root for the `Entity` kind of memory entry — the
 * software-domain "thing" the assistant references when reasoning
 * (a struct, a service, a teammate, a concept, ...).
 *
 * Mirrors the `entities` table documented in
 * `docs/03-modelo-datos.md` §4.5. Even though the persistence column
 * `description TEXT NOT NULL` is non-nullable, the domain models the
 * description as a discriminated union (`unknown | known` — see
 * `EntityDescription`) so the aggregate can faithfully distinguish
 * between "we have not learned a description yet" (the curator can
 * prioritise filling it) and "we know the description". The
 * persistence adapter is responsible for materialising the unknown
 * variant as the empty string when writing to SQL (the same string the
 * `searchable_text` join uses for absent values, per
 * `docs/03-modelo-datos.md` §5).
 *
 * Invariants:
 * - Identity is immutable.
 * - The `(name, kind)` pair is logically unique within a workspace —
 *   the persistence schema enforces it via `UNIQUE (name, entity_kind)`.
 *   The aggregate trusts the application layer to prevent collisions
 *   at write time (a domain service or use case would query the
 *   repository before calling `register`).
 * - `useCount` is monotonic.
 * - `embeddingStatus` is reset to `pending` only when a description
 *   change actually alters the searchable_text (see
 *   `updateDescription`); this avoids spurious re-embed work when the
 *   payload did not change.
 */
export class Entity {
  private readonly id: EntityId;
  private readonly workspaceId: WorkspaceId;
  private readonly name: EntityName;
  private readonly kind: EntityKind;
  private description: EntityDescription;
  private readonly tags: Tags;
  private readonly confidence: Confidence;
  private useCount: UseCount;
  private lastUsed: LastUsed;
  private readonly scope: Scope;
  private embeddingStatus: EmbeddingStatus;
  private readonly createdAt: Timestamp;
  private updatedAt: Timestamp;
  private readonly events: DomainEvent[];

  private constructor(input: {
    id: EntityId;
    workspaceId: WorkspaceId;
    name: EntityName;
    kind: EntityKind;
    description: EntityDescription;
    tags: Tags;
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
    this.name = input.name;
    this.kind = input.kind;
    this.description = input.description;
    this.tags = input.tags;
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
   * Brings a brand-new `Entity` into existence. Emits
   * `EntityRegistered`.
   *
   * The application layer is expected to have rejected duplicate
   * `(name, kind)` pairs already. When the caller does not yet have a
   * description, pass `EntityDescription.unknown()` (also the default
   * when the field is omitted).
   */
  public static register(input: {
    id: EntityId;
    workspaceId: WorkspaceId;
    name: EntityName;
    kind: EntityKind;
    description?: EntityDescription;
    tags: Tags;
    confidence: Confidence;
    scope: Scope;
    embeddingStatus: EmbeddingStatus;
    occurredAt: Timestamp;
  }): Entity {
    const event = new EntityRegistered({
      workspaceId: input.workspaceId,
      entityId: input.id,
      occurredAt: input.occurredAt,
    });
    return new Entity({
      id: input.id,
      workspaceId: input.workspaceId,
      name: input.name,
      kind: input.kind,
      description: input.description ?? EntityDescription.unknown(),
      tags: input.tags,
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
   * Rehydrates an `Entity` from previously-persisted state.
   */
  public static rehydrate(input: {
    id: EntityId;
    workspaceId: WorkspaceId;
    name: EntityName;
    kind: EntityKind;
    description: EntityDescription;
    tags: Tags;
    confidence: Confidence;
    useCount: UseCount;
    lastUsed: LastUsed;
    scope: Scope;
    embeddingStatus: EmbeddingStatus;
    createdAt: Timestamp;
    updatedAt: Timestamp;
  }): Entity {
    return new Entity({
      id: input.id,
      workspaceId: input.workspaceId,
      name: input.name,
      kind: input.kind,
      description: input.description,
      tags: input.tags,
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
   * Records a use. Mirrors `Decision.markUsed` for the entity kind.
   */
  public markUsed(input: { occurredAt: Timestamp }): void {
    this.useCount = this.useCount.increment();
    this.lastUsed = this.lastUsed.touch(input.occurredAt);
    this.updatedAt = input.occurredAt;
    this.events.push(
      new EntityUsed({
        workspaceId: this.workspaceId,
        entityId: this.id,
        occurredAt: input.occurredAt,
      }),
    );
  }

  /**
   * Replaces the description with a new value (which can be the
   * `unknown` variant to express "we no longer know the description").
   *
   * The embedding status is reset to `pending` ONLY when the new
   * description differs from the previous one — re-embedding the same
   * `name + kind + description` payload would be wasted work. When the
   * description is unchanged the aggregate still emits
   * `EntityDescribed` (the call signal is meaningful), but the
   * embedding-queue worker is not nudged again.
   *
   * Emits `EntityDescribed`.
   */
  public updateDescription(input: {
    description: EntityDescription;
    occurredAt: Timestamp;
  }): void {
    const descriptionChanged = !this.description.equals(input.description);
    this.description = input.description;
    if (descriptionChanged) {
      this.embeddingStatus = EmbeddingStatus.pending();
    }
    this.updatedAt = input.occurredAt;
    this.events.push(
      new EntityDescribed({
        workspaceId: this.workspaceId,
        entityId: this.id,
        occurredAt: input.occurredAt,
      }),
    );
  }

  // -- queries -------------------------------------------------------------

  public getId(): EntityId {
    return this.id;
  }

  public getWorkspaceId(): WorkspaceId {
    return this.workspaceId;
  }

  public getName(): EntityName {
    return this.name;
  }

  public getKind(): EntityKind {
    return this.kind;
  }

  public getDescription(): EntityDescription {
    return this.description;
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

  public getCreatedAt(): Timestamp {
    return this.createdAt;
  }

  public getUpdatedAt(): Timestamp {
    return this.updatedAt;
  }

  public pullEvents(): readonly DomainEvent[] {
    if (this.events.length === 0) return Object.freeze([]);
    const drained = this.events.slice();
    this.events.length = 0;
    return Object.freeze(drained);
  }
}
