import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteDecisionRepository } from "../../../../src/modules/memory/infrastructure/persistence/sqlite-decision-repository.ts";
import { Decision } from "../../../../src/modules/memory/domain/aggregates/decision.ts";
import { DecisionId } from "../../../../src/modules/memory/domain/value-objects/decision-id.ts";
import { DecisionStatus } from "../../../../src/modules/memory/domain/value-objects/decision-status.ts";
import { DecisionTitle } from "../../../../src/modules/memory/domain/value-objects/decision-title.ts";
import { DecisionContent } from "../../../../src/modules/memory/domain/value-objects/decision-content.ts";
import { Rationale } from "../../../../src/modules/memory/domain/value-objects/rationale.ts";
import { Scope } from "../../../../src/modules/memory/domain/value-objects/scope.ts";
import { EmbeddingStatus } from "../../../../src/modules/memory/domain/value-objects/embedding-status.ts";
import { Confidence } from "../../../../src/shared/domain/value-objects/confidence.ts";
import { WorkspaceId } from "../../../../src/shared/domain/value-objects/workspace-id.ts";
import { newMemoryDatabase } from "../../../_fixtures/memory-database.ts";
import {
  ANCHOR_TIME_MS,
  FIXED_DECISION_UUID,
  makeTags,
  makeTimestamp,
  makeWorkspaceId,
} from "../../../helpers/factories.ts";

const SECOND_DECISION_UUID = "01952f3c-2222-7000-8000-bbbbbbbbbb02";
const OTHER_WORKSPACE_UUID = "01952f3c-2222-7000-8000-aaaaaaaaaa99";

interface Ctx {
  db: Awaited<ReturnType<typeof newMemoryDatabase>>;
  repo: SqliteDecisionRepository;
}

let ctx: Ctx;

beforeEach(async () => {
  const db = await newMemoryDatabase();
  const repo = new SqliteDecisionRepository(db, makeWorkspaceId());
  ctx = { db, repo };
});

afterEach(() => {
  ctx.db.close();
});

function buildDecision(args: {
  id: string;
  title?: string;
  superseded?: string | null;
  scope?: Scope;
  occurredAtMs?: number;
}): Decision {
  const d = Decision.record({
    id: DecisionId.from(args.id),
    workspaceId: makeWorkspaceId(),
    sessionId: null,
    title: DecisionTitle.from(args.title ?? "Adopt SQLCipher"),
    rationale: Rationale.from("encryption at rest"),
    content: DecisionContent.from(
      "Encryption at rest using SQLCipher. Long-form body explaining the choice.",
    ),
    tags: makeTags(["db"]),
    confidence: Confidence.full(),
    scope: args.scope ?? Scope.project(),
    embeddingStatus: EmbeddingStatus.pending(),
    occurredAt: makeTimestamp(args.occurredAtMs ?? ANCHOR_TIME_MS),
  });
  if (args.superseded !== undefined && args.superseded !== null) {
    d.supersede({
      successorId: DecisionId.from(args.superseded),
      occurredAt: makeTimestamp((args.occurredAtMs ?? ANCHOR_TIME_MS) + 1),
    });
  }
  d.pullEvents();
  return d;
}

describe("SqliteDecisionRepository.save + findById", () => {
  it("inserts a fresh decision and reads it back", async () => {
    const d = buildDecision({ id: FIXED_DECISION_UUID });
    await ctx.repo.save(d);
    const loaded = await ctx.repo.findById(DecisionId.from(FIXED_DECISION_UUID));
    expect(loaded).not.toBe(null);
    expect(loaded?.getId().toString()).toBe(FIXED_DECISION_UUID);
    expect(loaded?.getTitle().toString()).toBe("Adopt SQLCipher");
    expect(loaded?.getStatus().isActive()).toBe(true);
  });

  it("upserts on second save (id unchanged)", async () => {
    const d = buildDecision({ id: FIXED_DECISION_UUID });
    await ctx.repo.save(d);
    d.markUsed({ occurredAt: makeTimestamp(ANCHOR_TIME_MS + 1000) });
    await ctx.repo.save(d);
    const loaded = await ctx.repo.findById(DecisionId.from(FIXED_DECISION_UUID));
    expect(loaded?.getUseCount().value).toBe(1);
  });

  it("returns null on miss", async () => {
    const loaded = await ctx.repo.findById(DecisionId.from(FIXED_DECISION_UUID));
    expect(loaded).toBe(null);
  });

  it("persists supersession metadata correctly", async () => {
    const d = buildDecision({
      id: FIXED_DECISION_UUID,
      superseded: SECOND_DECISION_UUID,
    });
    await ctx.repo.save(d);
    const loaded = await ctx.repo.findById(DecisionId.from(FIXED_DECISION_UUID));
    expect(loaded?.getStatus().isSuperseded()).toBe(true);
    expect(loaded?.getSupersededBy()?.decisionId.toString()).toBe(
      SECOND_DECISION_UUID,
    );
  });

  it("persists module scope correctly", async () => {
    const d = buildDecision({
      id: FIXED_DECISION_UUID,
      scope: Scope.module("auth"),
    });
    await ctx.repo.save(d);
    const loaded = await ctx.repo.findById(DecisionId.from(FIXED_DECISION_UUID));
    expect(loaded?.getScope().isModule()).toBe(true);
    expect(loaded?.getScope().module).toBe("auth");
  });
});

describe("SqliteDecisionRepository.findByWorkspace", () => {
  it("returns all decisions when status filter omitted", async () => {
    await ctx.repo.save(buildDecision({ id: FIXED_DECISION_UUID }));
    await ctx.repo.save(
      buildDecision({
        id: SECOND_DECISION_UUID,
        title: "T2",
        occurredAtMs: ANCHOR_TIME_MS + 100,
      }),
    );
    const all = await ctx.repo.findByWorkspace(makeWorkspaceId());
    expect(all.length).toBe(2);
  });

  it("filters by active status", async () => {
    await ctx.repo.save(buildDecision({ id: FIXED_DECISION_UUID }));
    await ctx.repo.save(
      buildDecision({
        id: SECOND_DECISION_UUID,
        title: "T2",
        superseded: FIXED_DECISION_UUID,
      }),
    );
    const active = await ctx.repo.findByWorkspace(
      makeWorkspaceId(),
      DecisionStatus.active(),
    );
    expect(active.length).toBe(1);
    expect(active[0]?.getId().toString()).toBe(FIXED_DECISION_UUID);
  });

  it("filters by superseded status", async () => {
    await ctx.repo.save(buildDecision({ id: FIXED_DECISION_UUID }));
    await ctx.repo.save(
      buildDecision({
        id: SECOND_DECISION_UUID,
        title: "T2",
        superseded: FIXED_DECISION_UUID,
      }),
    );
    const superseded = await ctx.repo.findByWorkspace(
      makeWorkspaceId(),
      DecisionStatus.superseded(),
    );
    expect(superseded.length).toBe(1);
    expect(superseded[0]?.getId().toString()).toBe(SECOND_DECISION_UUID);
  });

  it("rejects when workspace id does not match adapter pin", async () => {
    await expect(
      ctx.repo.findByWorkspace(WorkspaceId.from(OTHER_WORKSPACE_UUID)),
    ).rejects.toMatchObject({
      code: "memory.persistence.query-failed",
    });
  });
});

describe("SqliteDecisionRepository.findActiveByTags", () => {
  it("filters by required tag set", async () => {
    const ws = makeWorkspaceId();
    const d1 = Decision.record({
      id: DecisionId.from(FIXED_DECISION_UUID),
      workspaceId: ws,
      sessionId: null,
      title: DecisionTitle.from("T1"),
      rationale: Rationale.from("r"),
      content: DecisionContent.from("Body 1"),
      tags: makeTags(["db", "perf"]),
      confidence: Confidence.full(),
      scope: Scope.project(),
      embeddingStatus: EmbeddingStatus.pending(),
      occurredAt: makeTimestamp(),
    });
    d1.pullEvents();
    const d2 = Decision.record({
      id: DecisionId.from(SECOND_DECISION_UUID),
      workspaceId: ws,
      sessionId: null,
      title: DecisionTitle.from("T2"),
      rationale: Rationale.from("r"),
      content: DecisionContent.from("Body 2"),
      tags: makeTags(["sec"]),
      confidence: Confidence.full(),
      scope: Scope.project(),
      embeddingStatus: EmbeddingStatus.pending(),
      occurredAt: makeTimestamp(ANCHOR_TIME_MS + 10),
    });
    d2.pullEvents();
    await ctx.repo.save(d1);
    await ctx.repo.save(d2);
    const filtered = await ctx.repo.findActiveByTags(ws, makeTags(["db"]));
    expect(filtered.length).toBe(1);
    expect(filtered[0]?.getId().toString()).toBe(FIXED_DECISION_UUID);
  });

  it("returns all active when required tags is empty", async () => {
    await ctx.repo.save(buildDecision({ id: FIXED_DECISION_UUID }));
    const all = await ctx.repo.findActiveByTags(makeWorkspaceId(), makeTags());
    expect(all.length).toBe(1);
  });
});

describe("SqliteDecisionRepository row malformed paths", () => {
  it("rejects rows with malformed tags_json", async () => {
    ctx.db.exec(
      `INSERT INTO decisions (id, created_at_ms, title, rationale, scope, confidence, last_used_ms, use_count, tags_json) VALUES ('${FIXED_DECISION_UUID}', ${String(ANCHOR_TIME_MS)}, 'T', 'R', 'project', 1, ${String(ANCHOR_TIME_MS)}, 0, 'not-json')`,
    );
    await expect(
      ctx.repo.findById(DecisionId.from(FIXED_DECISION_UUID)),
    ).rejects.toMatchObject({ code: "memory.persistence.row-malformed" });
  });

  it("rejects rows that fail Zod schema validation", async () => {
    // Empty title violates min(1).
    ctx.db.exec(
      `INSERT INTO decisions (id, created_at_ms, title, rationale, scope, confidence, last_used_ms, use_count, tags_json) VALUES ('${FIXED_DECISION_UUID}', ${String(ANCHOR_TIME_MS)}, '', 'R', 'project', 1, ${String(ANCHOR_TIME_MS)}, 0, '[]')`,
    );
    await expect(
      ctx.repo.findById(DecisionId.from(FIXED_DECISION_UUID)),
    ).rejects.toMatchObject({ code: "memory.persistence.row-malformed" });
  });
});
