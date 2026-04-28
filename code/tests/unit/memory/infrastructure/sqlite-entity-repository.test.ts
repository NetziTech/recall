import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteEntityRepository } from "../../../../src/modules/memory/infrastructure/persistence/sqlite-entity-repository.ts";
import { Entity } from "../../../../src/modules/memory/domain/aggregates/entity.ts";
import { EntityId } from "../../../../src/modules/memory/domain/value-objects/entity-id.ts";
import { EntityKind } from "../../../../src/modules/memory/domain/value-objects/entity-kind.ts";
import { EntityName } from "../../../../src/modules/memory/domain/value-objects/entity-name.ts";
import { EntityDescription } from "../../../../src/modules/memory/domain/value-objects/entity-description.ts";
import { Scope } from "../../../../src/modules/memory/domain/value-objects/scope.ts";
import { EmbeddingStatus } from "../../../../src/modules/memory/domain/value-objects/embedding-status.ts";
import { Confidence } from "../../../../src/shared/domain/value-objects/confidence.ts";
import { WorkspaceId } from "../../../../src/shared/domain/value-objects/workspace-id.ts";
import { newMemoryDatabase } from "../../../_fixtures/memory-database.ts";
import {
  ANCHOR_TIME_MS,
  FIXED_ENTITY_UUID,
  makeTags,
  makeTimestamp,
  makeWorkspaceId,
} from "../../../helpers/factories.ts";

const SECOND_ENTITY_UUID = "01952f3c-2222-7000-8000-eeeeeeeeee02";
const OTHER_WS = "01952f3c-2222-7000-8000-aaaaaaaaaa99";

interface Ctx {
  db: Awaited<ReturnType<typeof newMemoryDatabase>>;
  repo: SqliteEntityRepository;
}
let ctx: Ctx;

beforeEach(async () => {
  const db = await newMemoryDatabase();
  ctx = { db, repo: new SqliteEntityRepository(db, makeWorkspaceId()) };
});
afterEach(() => {
  ctx.db.close();
});

function buildEntity(args: {
  id: string;
  name?: string;
  kind?: EntityKind;
  description?: EntityDescription;
}): Entity {
  const e = Entity.register({
    id: EntityId.from(args.id),
    workspaceId: makeWorkspaceId(),
    name: EntityName.from(args.name ?? `E-${args.id.slice(-4)}`),
    kind: args.kind ?? EntityKind.classKind(),
    description: args.description ?? EntityDescription.of("desc"),
    tags: makeTags(["x"]),
    confidence: Confidence.full(),
    scope: Scope.project(),
    embeddingStatus: EmbeddingStatus.pending(),
    occurredAt: makeTimestamp(),
  });
  e.pullEvents();
  return e;
}

describe("SqliteEntityRepository CRUD", () => {
  it("save+findById round-trips name, kind, description", async () => {
    await ctx.repo.save(buildEntity({ id: FIXED_ENTITY_UUID, name: "Foo" }));
    const loaded = await ctx.repo.findById(EntityId.from(FIXED_ENTITY_UUID));
    expect(loaded?.getName().toString()).toBe("Foo");
    expect(loaded?.getKind().toString()).toBe("class");
    expect(loaded?.getDescription().toStringOrNull()).toBe("desc");
  });

  it("persists unknown description as null on read", async () => {
    await ctx.repo.save(
      buildEntity({
        id: FIXED_ENTITY_UUID,
        description: EntityDescription.unknown(),
      }),
    );
    const loaded = await ctx.repo.findById(EntityId.from(FIXED_ENTITY_UUID));
    expect(loaded?.getDescription().toStringOrNull()).toBe(null);
  });

  it("upserts on second save", async () => {
    const e = buildEntity({ id: FIXED_ENTITY_UUID });
    await ctx.repo.save(e);
    e.markUsed({ occurredAt: makeTimestamp(ANCHOR_TIME_MS + 1000) });
    await ctx.repo.save(e);
    const loaded = await ctx.repo.findById(EntityId.from(FIXED_ENTITY_UUID));
    expect(loaded?.getUseCount().value).toBe(1);
  });

  it("findById returns null on miss", async () => {
    expect(await ctx.repo.findById(EntityId.from(FIXED_ENTITY_UUID))).toBe(null);
  });
});

describe("SqliteEntityRepository.findByWorkspace + findByNameAndKind", () => {
  it("findByWorkspace returns all", async () => {
    await ctx.repo.save(buildEntity({ id: FIXED_ENTITY_UUID, name: "A" }));
    await ctx.repo.save(buildEntity({ id: SECOND_ENTITY_UUID, name: "B" }));
    const all = await ctx.repo.findByWorkspace(makeWorkspaceId());
    expect(all.length).toBe(2);
  });

  it("findByWorkspace filters by kind", async () => {
    await ctx.repo.save(
      buildEntity({
        id: FIXED_ENTITY_UUID,
        name: "A",
        kind: EntityKind.classKind(),
      }),
    );
    await ctx.repo.save(
      buildEntity({
        id: SECOND_ENTITY_UUID,
        name: "B",
        kind: EntityKind.serviceKind(),
      }),
    );
    const services = await ctx.repo.findByWorkspace(
      makeWorkspaceId(),
      EntityKind.serviceKind(),
    );
    expect(services.length).toBe(1);
    expect(services[0]?.getName().toString()).toBe("B");
  });

  it("findByNameAndKind returns matching entity", async () => {
    await ctx.repo.save(
      buildEntity({
        id: FIXED_ENTITY_UUID,
        name: "Foo",
        kind: EntityKind.classKind(),
      }),
    );
    const found = await ctx.repo.findByNameAndKind(
      makeWorkspaceId(),
      EntityName.from("Foo"),
      EntityKind.classKind(),
    );
    expect(found?.getId().toString()).toBe(FIXED_ENTITY_UUID);
  });

  it("findByNameAndKind returns null on miss", async () => {
    const result = await ctx.repo.findByNameAndKind(
      makeWorkspaceId(),
      EntityName.from("None"),
      EntityKind.classKind(),
    );
    expect(result).toBe(null);
  });

  it("rejects mismatched workspace on findByWorkspace", async () => {
    await expect(
      ctx.repo.findByWorkspace(WorkspaceId.from(OTHER_WS)),
    ).rejects.toMatchObject({
      code: "memory.persistence.query-failed",
    });
  });

  it("rejects mismatched workspace on findByNameAndKind", async () => {
    await expect(
      ctx.repo.findByNameAndKind(
        WorkspaceId.from(OTHER_WS),
        EntityName.from("X"),
        EntityKind.classKind(),
      ),
    ).rejects.toMatchObject({
      code: "memory.persistence.query-failed",
    });
  });

  it("rejects rows with malformed tags_json", async () => {
    ctx.db.exec(
      `INSERT INTO entities (id, name, entity_kind, description, created_at_ms, updated_at_ms, confidence, last_used_ms, use_count, tags_json) VALUES ('${FIXED_ENTITY_UUID}', 'E', 'class', 'd', ${String(ANCHOR_TIME_MS)}, ${String(ANCHOR_TIME_MS)}, 1, ${String(ANCHOR_TIME_MS)}, 0, 'not-json')`,
    );
    await expect(
      ctx.repo.findById(EntityId.from(FIXED_ENTITY_UUID)),
    ).rejects.toMatchObject({ code: "memory.persistence.row-malformed" });
  });
});
