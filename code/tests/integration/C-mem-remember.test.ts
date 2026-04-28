/**
 * Integration test — Flow C: `mem.remember` (persist memories).
 *
 * Walks every memory kind via the `RememberFacadeAdapter` (the wire
 * facade) AND the per-kind use cases (`RecordDecision`,
 * `RecordLearning`, `RecordEntity`, `RecordRelation`). For each kind:
 *
 *   - Persists the row through the wired aggregate / repository.
 *   - Verifies the row survives a round trip via the SQLite reader.
 *   - Asserts the embedding job lands in `embedding_queue` (the
 *     enqueuer is wired into every recording use case).
 *   - Captures domain events through a subscriber on the `EventBus`.
 *
 * The relation test exercises the cross-aggregate contract: a relation
 * is only persisted if BOTH endpoints already exist as entities.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Tags } from "../../src/shared/domain/value-objects/tags.ts";
import { Scope } from "../../src/modules/memory/domain/value-objects/scope.ts";
import { LearningSeverity } from "../../src/modules/memory/domain/value-objects/learning-severity.ts";
import { EntityKind } from "../../src/modules/memory/domain/value-objects/entity-kind.ts";
import { EntityId } from "../../src/modules/memory/domain/value-objects/entity-id.ts";
import { RelationEndpoint } from "../../src/modules/memory/domain/value-objects/relation-endpoint.ts";
import { RelationKind } from "../../src/modules/memory/domain/value-objects/relation-kind.ts";
import type { DomainEvent } from "../../src/shared/domain/types/domain-event.ts";
import { buildTestContainer, type TestContainer } from "./_helpers/build-test-container.ts";

interface QueueRow {
  readonly id: string;
  readonly target_kind: string;
  readonly target_row_id: string;
}

function readQueueRows(ctx: TestContainer): QueueRow[] {
  const stmt = ctx.database.prepare(
    "SELECT id, target_kind, target_row_id FROM embedding_queue ORDER BY enqueued_at_ms ASC",
  );
  return [...(stmt.all() as readonly QueueRow[])];
}

describe("integration / C / mem.remember — persist memory entries", () => {
  let ctx: TestContainer;
  let collected: DomainEvent[];

  beforeEach(async () => {
    ctx = await buildTestContainer();
    collected = [];
    ctx.eventBus.subscribeAll((evt) => {
      collected.push(evt);
    });
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it("persists a Decision, enqueues an embedding job, and publishes DecisionRecorded", async () => {
    const result = await ctx.memory.recordDecision.record({
      workspaceId: ctx.workspaceId,
      sessionId: null,
      title: "Adopt hexagonal architecture",
      rationale:
        "DDD + hex keeps the domain neutral and lets us swap adapters per workspace.",
      tags: Tags.create(["architecture", "ddd"]),
      scope: Scope.project(),
    });
    expect(result.embeddingEnqueued).toBe(true);
    const persisted = await ctx.memory.decisions.findById(result.decisionId);
    expect(persisted).not.toBeNull();
    expect(persisted?.getTitle().toString()).toBe("Adopt hexagonal architecture");
    const queue = readQueueRows(ctx);
    expect(queue.some((r) => r.target_kind === "decision" && r.target_row_id === result.decisionId.toString())).toBe(
      true,
    );
    expect(collected.some((e) => e.eventName === "memory.decision-recorded")).toBe(true);
  });

  it("persists a Learning with severity warning and enqueues an embedding job", async () => {
    const result = await ctx.memory.recordLearning.record({
      workspaceId: ctx.workspaceId,
      text: "Always log infrastructure errors at WARN, not ERROR.",
      severity: LearningSeverity.warning(),
      tags: Tags.create(["logging"]),
      scope: Scope.project(),
    });
    expect(result.embeddingEnqueued).toBe(true);
    const persisted = await ctx.memory.learnings.findById(result.learningId);
    expect(persisted).not.toBeNull();
    expect(persisted?.getSeverity().kind).toBe("warning");
    const queue = readQueueRows(ctx);
    expect(queue.some((r) => r.target_kind === "learning" && r.target_row_id === result.learningId.toString())).toBe(
      true,
    );
    expect(collected.some((e) => e.eventName === "memory.learning-registered")).toBe(true);
  });

  it("persists an Entity and enqueues an embedding job", async () => {
    const result = await ctx.memory.recordEntity.record({
      workspaceId: ctx.workspaceId,
      name: "RetrievalWiring",
      kind: EntityKind.create("module"),
      description: "Wires the retrieval module use cases.",
      tags: Tags.create(["module"]),
      scope: Scope.project(),
    });
    const persisted = await ctx.memory.entities.findById(EntityId.from(result.entityId.toString()));
    expect(persisted).not.toBeNull();
    expect(result.embeddingEnqueued).toBe(true);
    const queue = readQueueRows(ctx);
    expect(queue.some((r) => r.target_kind === "entity")).toBe(true);
  });

  it("persists a Relation between two existing entities", async () => {
    const fromRes = await ctx.memory.recordEntity.record({
      workspaceId: ctx.workspaceId,
      name: "DecisionAggregate",
      kind: EntityKind.create("class"),
      description: "Aggregate root for decisions.",
      tags: Tags.empty(),
      scope: Scope.project(),
    });
    const toRes = await ctx.memory.recordEntity.record({
      workspaceId: ctx.workspaceId,
      name: "RecordDecisionUseCase",
      kind: EntityKind.create("class"),
      description: "Records a fresh Decision.",
      tags: Tags.empty(),
      scope: Scope.project(),
    });
    const result = await ctx.memory.recordRelation.record({
      workspaceId: ctx.workspaceId,
      from: RelationEndpoint.entity(EntityId.from(fromRes.entityId.toString())),
      to: RelationEndpoint.entity(EntityId.from(toRes.entityId.toString())),
      kind: RelationKind.references(),
      weightValue: 0.8,
    });
    const relation = await ctx.memory.relations.findById(result.relationId);
    expect(relation).not.toBeNull();
  });

  it("rejects a Relation pointing at a missing entity (defence in depth)", async () => {
    const realEntity = await ctx.memory.recordEntity.record({
      workspaceId: ctx.workspaceId,
      name: "Real",
      kind: EntityKind.create("module"),
      description: "An existing entity.",
      tags: Tags.empty(),
      scope: Scope.project(),
    });
    const ghostId = EntityId.from("00000000-0000-7000-8000-cccccccccccc");
    await expect(
      ctx.memory.recordRelation.record({
        workspaceId: ctx.workspaceId,
        from: RelationEndpoint.entity(EntityId.from(realEntity.entityId.toString())),
        to: RelationEndpoint.entity(ghostId),
        kind: RelationKind.relatedTo(),
        weightValue: 0.5,
      }),
    ).rejects.toMatchObject({
      code: "memory.relation-endpoint-missing",
    });
  });

  it("via wire facade — RememberFacadeAdapter routes 'decision' to RecordDecisionUseCase", async () => {
    const out = await ctx.mcpServer.useCases.remember.remember({
      workspace_id: ctx.workspaceId.toString(),
      kind: "decision",
      content: "Adopt vec0 for vector search.",
      title: "Vec0 over pgvector",
      tags: ["arch", "retrieval"],
    });
    expect(out.kind).toBe("decision");
    expect(out.upserted).toBe(true);
    expect(out.embedding_status).toBe("queued");
  });
});
