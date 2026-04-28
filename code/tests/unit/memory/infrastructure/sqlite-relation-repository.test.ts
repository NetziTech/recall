import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteRelationRepository } from "../../../../src/modules/memory/infrastructure/persistence/sqlite-relation-repository.ts";
import { SqliteEntityRepository } from "../../../../src/modules/memory/infrastructure/persistence/sqlite-entity-repository.ts";
import { Relation } from "../../../../src/modules/memory/domain/aggregates/relation.ts";
import { Entity } from "../../../../src/modules/memory/domain/aggregates/entity.ts";
import { RelationId } from "../../../../src/modules/memory/domain/value-objects/relation-id.ts";
import { RelationKind } from "../../../../src/modules/memory/domain/value-objects/relation-kind.ts";
import { RelationEndpoint } from "../../../../src/modules/memory/domain/value-objects/relation-endpoint.ts";
import { EntityId } from "../../../../src/modules/memory/domain/value-objects/entity-id.ts";
import { EntityKind } from "../../../../src/modules/memory/domain/value-objects/entity-kind.ts";
import { EntityName } from "../../../../src/modules/memory/domain/value-objects/entity-name.ts";
import { EntityDescription } from "../../../../src/modules/memory/domain/value-objects/entity-description.ts";
import { EmbeddingStatus } from "../../../../src/modules/memory/domain/value-objects/embedding-status.ts";
import { Scope } from "../../../../src/modules/memory/domain/value-objects/scope.ts";
import { DecisionId } from "../../../../src/modules/memory/domain/value-objects/decision-id.ts";
import { Confidence } from "../../../../src/shared/domain/value-objects/confidence.ts";
import { WorkspaceId } from "../../../../src/shared/domain/value-objects/workspace-id.ts";
import { newMemoryDatabase } from "../../../_fixtures/memory-database.ts";
import {
  FIXED_DECISION_UUID,
  FIXED_RELATION_UUID,
  makeTags,
  makeTimestamp,
  makeWorkspaceId,
} from "../../../helpers/factories.ts";

const ENTITY_A = "01952f3c-2222-7000-8000-eeeeeeeeee01";
const ENTITY_B = "01952f3c-2222-7000-8000-eeeeeeeeee02";
const ENTITY_C = "01952f3c-2222-7000-8000-eeeeeeeeee03";
const SECOND_RELATION_UUID = "01952f3c-2222-7000-8000-2222222222ab";
const OTHER_WS = "01952f3c-2222-7000-8000-aaaaaaaaaa99";

interface Ctx {
  db: Awaited<ReturnType<typeof newMemoryDatabase>>;
  repo: SqliteRelationRepository;
  entities: SqliteEntityRepository;
}
let ctx: Ctx;

beforeEach(async () => {
  const db = await newMemoryDatabase();
  ctx = {
    db,
    repo: new SqliteRelationRepository(db, makeWorkspaceId()),
    entities: new SqliteEntityRepository(db, makeWorkspaceId()),
  };
  // Seed entities so FK constraints are satisfied.
  for (const id of [ENTITY_A, ENTITY_B, ENTITY_C]) {
    const e = Entity.register({
      id: EntityId.from(id),
      workspaceId: makeWorkspaceId(),
      name: EntityName.from(`E-${id.slice(-4)}`),
      kind: EntityKind.classKind(),
      description: EntityDescription.unknown(),
      tags: makeTags(),
      confidence: Confidence.full(),
      scope: Scope.project(),
      embeddingStatus: EmbeddingStatus.pending(),
      occurredAt: makeTimestamp(),
    });
    e.pullEvents();
    await ctx.entities.save(e);
  }
});
afterEach(() => {
  ctx.db.close();
});

function buildRelation(args: {
  id: string;
  fromId: string;
  toId: string;
  kind?: RelationKind;
}): Relation {
  const r = Relation.create({
    id: RelationId.from(args.id),
    workspaceId: makeWorkspaceId(),
    from: RelationEndpoint.entity(EntityId.from(args.fromId)),
    to: RelationEndpoint.entity(EntityId.from(args.toId)),
    kind: args.kind ?? RelationKind.references(),
    weight: Confidence.full(),
    occurredAt: makeTimestamp(),
  });
  r.pullEvents();
  return r;
}

describe("SqliteRelationRepository CRUD", () => {
  it("save+findById round-trips endpoints + kind", async () => {
    await ctx.repo.save(
      buildRelation({
        id: FIXED_RELATION_UUID,
        fromId: ENTITY_A,
        toId: ENTITY_B,
        kind: RelationKind.dependsOn(),
      }),
    );
    const loaded = await ctx.repo.findById(RelationId.from(FIXED_RELATION_UUID));
    expect(loaded?.getFrom().idAsString()).toBe(ENTITY_A);
    expect(loaded?.getTo().idAsString()).toBe(ENTITY_B);
    expect(loaded?.getKind().toString()).toBe("depends_on");
  });

  it("findById returns null on miss", async () => {
    expect(
      await ctx.repo.findById(RelationId.from(FIXED_RELATION_UUID)),
    ).toBe(null);
  });

  it("rejects non-entity endpoint at save time", async () => {
    const decisionEndpoint = RelationEndpoint.decision(
      DecisionId.from(FIXED_DECISION_UUID),
    );
    const entityEndpoint = RelationEndpoint.entity(EntityId.from(ENTITY_A));
    const rel = Relation.create({
      id: RelationId.from(FIXED_RELATION_UUID),
      workspaceId: makeWorkspaceId(),
      from: decisionEndpoint,
      to: entityEndpoint,
      kind: RelationKind.references(),
      weight: Confidence.full(),
      occurredAt: makeTimestamp(),
    });
    rel.pullEvents();
    await expect(ctx.repo.save(rel)).rejects.toMatchObject({
      code: "memory.persistence.upsert-failed",
    });
  });
});

describe("SqliteRelationRepository queries", () => {
  it("findFromEndpoint returns matching edges", async () => {
    await ctx.repo.save(
      buildRelation({
        id: FIXED_RELATION_UUID,
        fromId: ENTITY_A,
        toId: ENTITY_B,
      }),
    );
    await ctx.repo.save(
      buildRelation({
        id: SECOND_RELATION_UUID,
        fromId: ENTITY_C,
        toId: ENTITY_A,
      }),
    );
    const out = await ctx.repo.findFromEndpoint(
      RelationEndpoint.entity(EntityId.from(ENTITY_A)),
    );
    expect(out.length).toBe(1);
    expect(out[0]?.getId().toString()).toBe(FIXED_RELATION_UUID);
  });

  it("findFromEndpoint returns empty for non-entity endpoint", async () => {
    const out = await ctx.repo.findFromEndpoint(
      RelationEndpoint.decision(DecisionId.from(FIXED_DECISION_UUID)),
    );
    expect(out.length).toBe(0);
  });

  it("findToEndpoint returns matching edges", async () => {
    await ctx.repo.save(
      buildRelation({
        id: FIXED_RELATION_UUID,
        fromId: ENTITY_A,
        toId: ENTITY_B,
      }),
    );
    const out = await ctx.repo.findToEndpoint(
      RelationEndpoint.entity(EntityId.from(ENTITY_B)),
    );
    expect(out.length).toBe(1);
  });

  it("findToEndpoint returns empty for non-entity endpoint", async () => {
    const out = await ctx.repo.findToEndpoint(
      RelationEndpoint.decision(DecisionId.from(FIXED_DECISION_UUID)),
    );
    expect(out.length).toBe(0);
  });

  it("findAllByWorkspace returns all", async () => {
    await ctx.repo.save(
      buildRelation({
        id: FIXED_RELATION_UUID,
        fromId: ENTITY_A,
        toId: ENTITY_B,
      }),
    );
    const all = await ctx.repo.findAllByWorkspace(makeWorkspaceId());
    expect(all.length).toBe(1);
  });

  it("rejects mismatched workspace on findAllByWorkspace", async () => {
    await expect(
      ctx.repo.findAllByWorkspace(WorkspaceId.from(OTHER_WS)),
    ).rejects.toMatchObject({
      code: "memory.persistence.query-failed",
    });
  });

  it("rejects malformed row schema (empty relation kind)", async () => {
    ctx.db.exec(
      `INSERT INTO relations (id, from_entity_id, to_entity_id, relation, created_at_ms, confidence) VALUES ('${FIXED_RELATION_UUID}', '${ENTITY_A}', '${ENTITY_B}', '', ${String(0)}, 1)`,
    );
    await expect(
      ctx.repo.findById(RelationId.from(FIXED_RELATION_UUID)),
    ).rejects.toMatchObject({ code: "memory.persistence.row-malformed" });
  });
});
