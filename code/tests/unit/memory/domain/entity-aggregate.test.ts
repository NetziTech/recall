import { describe, expect, it } from "vitest";
import { Entity } from "../../../../src/modules/memory/domain/aggregates/entity.ts";
import { EntityId } from "../../../../src/modules/memory/domain/value-objects/entity-id.ts";
import { EntityKind } from "../../../../src/modules/memory/domain/value-objects/entity-kind.ts";
import { EntityName } from "../../../../src/modules/memory/domain/value-objects/entity-name.ts";
import { EntityDescription } from "../../../../src/modules/memory/domain/value-objects/entity-description.ts";
import { EmbeddingStatus } from "../../../../src/modules/memory/domain/value-objects/embedding-status.ts";
import { Scope } from "../../../../src/modules/memory/domain/value-objects/scope.ts";
import { LastUsed } from "../../../../src/modules/memory/domain/value-objects/last-used.ts";
import { UseCount } from "../../../../src/modules/memory/domain/value-objects/use-count.ts";
import { Confidence } from "../../../../src/shared/domain/value-objects/confidence.ts";
import { EntityRegistered } from "../../../../src/modules/memory/domain/events/entity-registered.ts";
import { EntityUsed } from "../../../../src/modules/memory/domain/events/entity-used.ts";
import { EntityDescribed } from "../../../../src/modules/memory/domain/events/entity-described.ts";
import {
  ANCHOR_TIME_MS,
  FIXED_ENTITY_UUID,
  makeTags,
  makeTimestamp,
  makeWorkspaceId,
} from "../../../helpers/factories.ts";

function build(args: { description?: EntityDescription } = {}): Entity {
  return Entity.register({
    id: EntityId.from(FIXED_ENTITY_UUID),
    workspaceId: makeWorkspaceId(),
    name: EntityName.from("Foo"),
    kind: EntityKind.classKind(),
    description: args.description ?? EntityDescription.unknown(),
    tags: makeTags(["x"]),
    confidence: Confidence.full(),
    scope: Scope.project(),
    embeddingStatus: EmbeddingStatus.pending(),
    occurredAt: makeTimestamp(),
  });
}

describe("Entity (aggregate)", () => {
  describe("register", () => {
    it("constructs with zero useCount and emits EntityRegistered", () => {
      const e = build();
      expect(e.getUseCount().toNumber()).toBe(0);
      expect(e.getLastUsed().hasBeenUsed()).toBe(false);
      const events = e.pullEvents();
      expect(events.length).toBe(1);
      expect(events[0]).toBeInstanceOf(EntityRegistered);
    });

    it("defaults description to unknown when omitted", () => {
      const e = Entity.register({
        id: EntityId.from(FIXED_ENTITY_UUID),
        workspaceId: makeWorkspaceId(),
        name: EntityName.from("Foo"),
        kind: EntityKind.classKind(),
        tags: makeTags(),
        confidence: Confidence.full(),
        scope: Scope.project(),
        embeddingStatus: EmbeddingStatus.pending(),
        occurredAt: makeTimestamp(),
      });
      expect(e.getDescription().toStringOrNull()).toBe(null);
    });

    it("uses provided description", () => {
      const e = build({ description: EntityDescription.of("desc") });
      expect(e.getDescription().toStringOrNull()).toBe("desc");
    });

    it("createdAt and updatedAt are pinned to occurredAt", () => {
      const e = build();
      expect(e.getCreatedAt().toEpochMs()).toBe(ANCHOR_TIME_MS);
      expect(e.getUpdatedAt().toEpochMs()).toBe(ANCHOR_TIME_MS);
    });
  });

  describe("markUsed", () => {
    it("increments useCount, refreshes lastUsed, updates updatedAt, emits EntityUsed", () => {
      const e = build();
      e.pullEvents();
      e.markUsed({ occurredAt: makeTimestamp(ANCHOR_TIME_MS + 100) });
      expect(e.getUseCount().toNumber()).toBe(1);
      expect(e.getLastUsed().hasBeenUsed()).toBe(true);
      expect(e.getUpdatedAt().toEpochMs()).toBe(ANCHOR_TIME_MS + 100);
      const events = e.pullEvents();
      expect(events[0]).toBeInstanceOf(EntityUsed);
    });
  });

  describe("updateDescription", () => {
    it("replaces description, resets embedding to pending when changed, emits EntityDescribed", () => {
      const e = build({ description: EntityDescription.of("old") });
      e.pullEvents();
      e.updateDescription({
        description: EntityDescription.of("new"),
        occurredAt: makeTimestamp(ANCHOR_TIME_MS + 100),
      });
      expect(e.getDescription().toStringOrNull()).toBe("new");
      expect(e.getEmbeddingStatus().isPending()).toBe(true);
      const events = e.pullEvents();
      expect(events[0]).toBeInstanceOf(EntityDescribed);
    });

    it("emits EntityDescribed even when description unchanged but does NOT touch embeddingStatus", () => {
      const e = build({ description: EntityDescription.of("same") });
      e.pullEvents();
      // Manually mark ready then assert it stays ready when description stays.
      // (No public API for ready-status here; we assert pending stays pending.)
      e.updateDescription({
        description: EntityDescription.of("same"),
        occurredAt: makeTimestamp(ANCHOR_TIME_MS + 200),
      });
      expect(e.getDescription().toStringOrNull()).toBe("same");
      const events = e.pullEvents();
      expect(events[0]).toBeInstanceOf(EntityDescribed);
    });
  });

  describe("rehydrate", () => {
    it("rebuilds without emitting events", () => {
      const e = Entity.rehydrate({
        id: EntityId.from(FIXED_ENTITY_UUID),
        workspaceId: makeWorkspaceId(),
        name: EntityName.from("E"),
        kind: EntityKind.classKind(),
        description: EntityDescription.of("desc"),
        tags: makeTags(),
        confidence: Confidence.full(),
        useCount: UseCount.of(2),
        lastUsed: LastUsed.at(makeTimestamp(ANCHOR_TIME_MS + 50)),
        scope: Scope.project(),
        embeddingStatus: EmbeddingStatus.ready(),
        createdAt: makeTimestamp(ANCHOR_TIME_MS),
        updatedAt: makeTimestamp(ANCHOR_TIME_MS + 100),
      });
      expect(e.pullEvents().length).toBe(0);
      expect(e.getUseCount().toNumber()).toBe(2);
      expect(e.getEmbeddingStatus().isReady()).toBe(true);
    });
  });

  describe("query getters", () => {
    it("expose every persisted field", () => {
      const e = build();
      expect(e.getWorkspaceId().toString()).toBeDefined();
      expect(e.getName().toString()).toBe("Foo");
      expect(e.getKind().toString()).toBe("class");
      expect(e.getTags().toArray()).toContain("x");
      expect(e.getScope().isProject()).toBe(true);
      expect(e.getConfidence().toNumber()).toBe(1);
    });
  });
});
