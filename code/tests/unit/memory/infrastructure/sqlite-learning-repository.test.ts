import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteLearningRepository } from "../../../../src/modules/memory/infrastructure/persistence/sqlite-learning-repository.ts";
import { Learning } from "../../../../src/modules/memory/domain/aggregates/learning.ts";
import { LearningId } from "../../../../src/modules/memory/domain/value-objects/learning-id.ts";
import { LearningSeverity } from "../../../../src/modules/memory/domain/value-objects/learning-severity.ts";
import { LearningText } from "../../../../src/modules/memory/domain/value-objects/learning-text.ts";
import { Scope } from "../../../../src/modules/memory/domain/value-objects/scope.ts";
import { EmbeddingStatus } from "../../../../src/modules/memory/domain/value-objects/embedding-status.ts";
import { Confidence } from "../../../../src/shared/domain/value-objects/confidence.ts";
import { WorkspaceId } from "../../../../src/shared/domain/value-objects/workspace-id.ts";
import { newMemoryDatabase } from "../../../_fixtures/memory-database.ts";
import {
  ANCHOR_TIME_MS,
  FIXED_LEARNING_UUID,
  makeTags,
  makeTimestamp,
  makeWorkspaceId,
} from "../../../helpers/factories.ts";

const SECOND_LEARNING_UUID = "01952f3c-2222-7000-8000-cccccccccc02";
const OTHER_WS = "01952f3c-2222-7000-8000-aaaaaaaaaa99";

interface Ctx {
  db: Awaited<ReturnType<typeof newMemoryDatabase>>;
  repo: SqliteLearningRepository;
}
let ctx: Ctx;

beforeEach(async () => {
  const db = await newMemoryDatabase();
  ctx = { db, repo: new SqliteLearningRepository(db, makeWorkspaceId()) };
});
afterEach(() => {
  ctx.db.close();
});

function buildLearning(args: {
  id: string;
  severity?: LearningSeverity;
  consolidatedInto?: string | null;
  scope?: Scope;
  occurredAtMs?: number;
}): Learning {
  const l = Learning.register({
    id: LearningId.from(args.id),
    workspaceId: makeWorkspaceId(),
    text: LearningText.from(`L-${args.id.slice(-4)}`),
    severity: args.severity ?? LearningSeverity.warning(),
    tags: makeTags(["x"]),
    confidence: Confidence.full(),
    scope: args.scope ?? Scope.project(),
    embeddingStatus: EmbeddingStatus.pending(),
    occurredAt: makeTimestamp(args.occurredAtMs ?? ANCHOR_TIME_MS),
  });
  if (args.consolidatedInto !== undefined && args.consolidatedInto !== null) {
    l.consolidateInto({
      targetId: LearningId.from(args.consolidatedInto),
      occurredAt: makeTimestamp((args.occurredAtMs ?? ANCHOR_TIME_MS) + 1),
    });
  }
  l.pullEvents();
  return l;
}

describe("SqliteLearningRepository CRUD", () => {
  it("save+findById round-trip preserves severity and tags", async () => {
    await ctx.repo.save(
      buildLearning({
        id: FIXED_LEARNING_UUID,
        severity: LearningSeverity.critical(),
      }),
    );
    const loaded = await ctx.repo.findById(LearningId.from(FIXED_LEARNING_UUID));
    expect(loaded?.getSeverity().isCritical()).toBe(true);
    expect(loaded?.getTags().toArray()).toContain("x");
  });

  it("upserts on second save", async () => {
    const l = buildLearning({ id: FIXED_LEARNING_UUID });
    await ctx.repo.save(l);
    l.markUsed({ occurredAt: makeTimestamp(ANCHOR_TIME_MS + 1000) });
    await ctx.repo.save(l);
    const loaded = await ctx.repo.findById(LearningId.from(FIXED_LEARNING_UUID));
    expect(loaded?.getUseCount().value).toBe(1);
  });

  it("returns null on miss", async () => {
    expect(
      await ctx.repo.findById(LearningId.from(FIXED_LEARNING_UUID)),
    ).toBe(null);
  });

  it("persists consolidated_into", async () => {
    await ctx.repo.save(
      buildLearning({
        id: FIXED_LEARNING_UUID,
        consolidatedInto: SECOND_LEARNING_UUID,
      }),
    );
    const loaded = await ctx.repo.findById(LearningId.from(FIXED_LEARNING_UUID));
    expect(loaded?.getConsolidatedInto()?.toString()).toBe(SECOND_LEARNING_UUID);
  });
});

describe("SqliteLearningRepository.findByWorkspace", () => {
  it("returns all learnings", async () => {
    await ctx.repo.save(buildLearning({ id: FIXED_LEARNING_UUID }));
    await ctx.repo.save(
      buildLearning({
        id: SECOND_LEARNING_UUID,
        occurredAtMs: ANCHOR_TIME_MS + 100,
      }),
    );
    const all = await ctx.repo.findByWorkspace(makeWorkspaceId());
    expect(all.length).toBe(2);
  });

  it("rejects mismatched workspace", async () => {
    await expect(
      ctx.repo.findByWorkspace(WorkspaceId.from(OTHER_WS)),
    ).rejects.toMatchObject({
      code: "memory.persistence.query-failed",
    });
  });
});

describe("SqliteLearningRepository.findActiveByMinimumSeverity", () => {
  it("filters by minimum severity", async () => {
    await ctx.repo.save(
      buildLearning({
        id: FIXED_LEARNING_UUID,
        severity: LearningSeverity.tip(),
      }),
    );
    await ctx.repo.save(
      buildLearning({
        id: SECOND_LEARNING_UUID,
        severity: LearningSeverity.critical(),
        occurredAtMs: ANCHOR_TIME_MS + 100,
      }),
    );
    const filtered = await ctx.repo.findActiveByMinimumSeverity(
      makeWorkspaceId(),
      LearningSeverity.warning(),
    );
    expect(filtered.length).toBe(1);
    expect(filtered[0]?.getSeverity().isCritical()).toBe(true);
  });

  it("rejects rows with malformed tags_json", async () => {
    ctx.db.exec(
      `INSERT INTO learnings (id, created_at_ms, content, severity, scope, confidence, last_used_ms, use_count, tags_json) VALUES ('${FIXED_LEARNING_UUID}', ${String(ANCHOR_TIME_MS)}, 'L', 'tip', 'project', 1, ${String(ANCHOR_TIME_MS)}, 0, 'not-json')`,
    );
    await expect(
      ctx.repo.findById(LearningId.from(FIXED_LEARNING_UUID)),
    ).rejects.toMatchObject({ code: "memory.persistence.row-malformed" });
  });

  it("excludes consolidated learnings", async () => {
    await ctx.repo.save(
      buildLearning({
        id: FIXED_LEARNING_UUID,
        consolidatedInto: SECOND_LEARNING_UUID,
      }),
    );
    await ctx.repo.save(
      buildLearning({
        id: SECOND_LEARNING_UUID,
        occurredAtMs: ANCHOR_TIME_MS + 100,
      }),
    );
    const result = await ctx.repo.findActiveByMinimumSeverity(
      makeWorkspaceId(),
      LearningSeverity.tip(),
    );
    expect(result.length).toBe(1);
    expect(result[0]?.getId().toString()).toBe(SECOND_LEARNING_UUID);
  });
});
