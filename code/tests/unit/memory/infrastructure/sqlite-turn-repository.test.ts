import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteTurnRepository } from "../../../../src/modules/memory/infrastructure/persistence/sqlite-turn-repository.ts";
import { Turn } from "../../../../src/modules/memory/domain/aggregates/turn.ts";
import { Session } from "../../../../src/modules/memory/domain/aggregates/session.ts";
import { TurnId } from "../../../../src/modules/memory/domain/value-objects/turn-id.ts";
import { TurnSummary } from "../../../../src/modules/memory/domain/value-objects/turn-summary.ts";
import { TurnIntent } from "../../../../src/modules/memory/domain/value-objects/turn-intent.ts";
import { TurnOutcome } from "../../../../src/modules/memory/domain/value-objects/turn-outcome.ts";
import { SessionId } from "../../../../src/modules/memory/domain/value-objects/session-id.ts";
import { DecisionId } from "../../../../src/modules/memory/domain/value-objects/decision-id.ts";
import { LearningId } from "../../../../src/modules/memory/domain/value-objects/learning-id.ts";
import { FilesTouched } from "../../../../src/modules/memory/domain/value-objects/files-touched.ts";
import { LinkedDecisionIds } from "../../../../src/modules/memory/domain/value-objects/linked-decision-ids.ts";
import { LinkedLearningIds } from "../../../../src/modules/memory/domain/value-objects/linked-learning-ids.ts";
import { Confidence } from "../../../../src/shared/domain/value-objects/confidence.ts";
import { WorkspaceId } from "../../../../src/shared/domain/value-objects/workspace-id.ts";
import { newMemoryDatabase } from "../../../_fixtures/memory-database.ts";
import { SqliteSessionRepository } from "../../../../src/modules/memory/infrastructure/persistence/sqlite-session-repository.ts";
import {
  ANCHOR_TIME_MS,
  FIXED_DECISION_UUID,
  FIXED_LEARNING_UUID,
  FIXED_SESSION_UUID,
  FIXED_TURN_UUID,
  makeTags,
  makeTimestamp,
  makeWorkspaceId,
} from "../../../helpers/factories.ts";

const SECOND_TURN_UUID = "01952f3c-2222-7000-8000-ffffffffff02";
const OTHER_WS = "01952f3c-2222-7000-8000-aaaaaaaaaa99";

interface Ctx {
  db: Awaited<ReturnType<typeof newMemoryDatabase>>;
  repo: SqliteTurnRepository;
  sessions: SqliteSessionRepository;
}
let ctx: Ctx;

beforeEach(async () => {
  const db = await newMemoryDatabase();
  ctx = {
    db,
    repo: new SqliteTurnRepository(db, makeWorkspaceId()),
    sessions: new SqliteSessionRepository(db, makeWorkspaceId()),
  };
  // Always seed an open session so turns can be inserted (FK constraint).
  const session = Session.start({
    id: SessionId.from(FIXED_SESSION_UUID),
    workspaceId: makeWorkspaceId(),
    startedAt: makeTimestamp(),
    intent: null,
    resumedFrom: null,
  });
  session.pullEvents();
  await ctx.sessions.save(session);
});
afterEach(() => {
  ctx.db.close();
});

function buildTurn(args: {
  id: string;
  occurredAtMs?: number;
  files?: readonly string[];
  linkedDecisions?: readonly string[];
  linkedLearnings?: readonly string[];
  intent?: string | null;
  outcome?: string | null;
}): Turn {
  return Turn.record({
    id: TurnId.from(args.id),
    workspaceId: makeWorkspaceId(),
    sessionId: SessionId.from(FIXED_SESSION_UUID),
    summary: TurnSummary.from(`Summary-${args.id.slice(-4)}`),
    intent: args.intent === undefined || args.intent === null
      ? null
      : TurnIntent.from(args.intent),
    outcome: args.outcome === undefined || args.outcome === null
      ? null
      : TurnOutcome.from(args.outcome),
    filesTouched:
      args.files === undefined || args.files.length === 0
        ? FilesTouched.empty()
        : FilesTouched.create(args.files),
    linkedDecisions:
      args.linkedDecisions === undefined || args.linkedDecisions.length === 0
        ? LinkedDecisionIds.empty()
        : LinkedDecisionIds.create(args.linkedDecisions.map((s) => DecisionId.from(s))),
    linkedLearnings:
      args.linkedLearnings === undefined || args.linkedLearnings.length === 0
        ? LinkedLearningIds.empty()
        : LinkedLearningIds.create(args.linkedLearnings.map((s) => LearningId.from(s))),
    tags: makeTags(["x"]),
    confidence: Confidence.full(),
    occurredAt: makeTimestamp(args.occurredAtMs ?? ANCHOR_TIME_MS),
  });
}

describe("SqliteTurnRepository CRUD", () => {
  it("save+findById preserves linked decisions / learnings / files", async () => {
    const turn = buildTurn({
      id: FIXED_TURN_UUID,
      files: ["a.ts", "b.ts"],
      linkedDecisions: [FIXED_DECISION_UUID],
      linkedLearnings: [FIXED_LEARNING_UUID],
      intent: "implement foo",
      outcome: "PR merged",
    });
    turn.pullEvents();
    await ctx.repo.save(turn);
    const loaded = await ctx.repo.findById(TurnId.from(FIXED_TURN_UUID));
    expect(loaded?.getFilesTouched().toArray()).toEqual(["a.ts", "b.ts"]);
    expect(loaded?.getLinkedDecisions().size()).toBe(1);
    expect(loaded?.getLinkedLearnings().size()).toBe(1);
    expect(loaded?.getIntent()?.toString()).toBe("implement foo");
    expect(loaded?.getOutcome()?.toString()).toBe("PR merged");
  });

  it("findById returns null on miss", async () => {
    expect(await ctx.repo.findById(TurnId.from(FIXED_TURN_UUID))).toBe(null);
  });

  it("upserts on second save (immutable body, mutable counters)", async () => {
    const turn = buildTurn({ id: FIXED_TURN_UUID });
    turn.pullEvents();
    await ctx.repo.save(turn);
    turn.markUsed({ occurredAt: makeTimestamp(ANCHOR_TIME_MS + 100) });
    await ctx.repo.save(turn);
    const loaded = await ctx.repo.findById(TurnId.from(FIXED_TURN_UUID));
    expect(loaded?.getUseCount().value).toBe(1);
  });
});

describe("SqliteTurnRepository queries", () => {
  it("findBySession returns turns ordered most-recent-first", async () => {
    const t1 = buildTurn({ id: FIXED_TURN_UUID, occurredAtMs: ANCHOR_TIME_MS });
    const t2 = buildTurn({ id: SECOND_TURN_UUID, occurredAtMs: ANCHOR_TIME_MS + 100 });
    t1.pullEvents();
    t2.pullEvents();
    await ctx.repo.save(t1);
    await ctx.repo.save(t2);
    const found = await ctx.repo.findBySession(
      SessionId.from(FIXED_SESSION_UUID),
      10,
    );
    expect(found.length).toBe(2);
    expect(found[0]?.getId().toString()).toBe(SECOND_TURN_UUID);
  });

  it("findBySession respects limit", async () => {
    const t1 = buildTurn({ id: FIXED_TURN_UUID, occurredAtMs: ANCHOR_TIME_MS });
    const t2 = buildTurn({ id: SECOND_TURN_UUID, occurredAtMs: ANCHOR_TIME_MS + 100 });
    t1.pullEvents();
    t2.pullEvents();
    await ctx.repo.save(t1);
    await ctx.repo.save(t2);
    const found = await ctx.repo.findBySession(
      SessionId.from(FIXED_SESSION_UUID),
      1,
    );
    expect(found.length).toBe(1);
  });

  it("findBySession rejects non-positive / non-integer limit", async () => {
    await expect(
      ctx.repo.findBySession(SessionId.from(FIXED_SESSION_UUID), 0),
    ).rejects.toMatchObject({ code: "memory.persistence.query-failed" });
    await expect(
      ctx.repo.findBySession(SessionId.from(FIXED_SESSION_UUID), 1.5),
    ).rejects.toMatchObject({ code: "memory.persistence.query-failed" });
  });

  it("findAllByWorkspace returns all turns", async () => {
    const t1 = buildTurn({ id: FIXED_TURN_UUID });
    t1.pullEvents();
    await ctx.repo.save(t1);
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

  it("rejects rows with malformed JSON in files_touched_json", async () => {
    // Insert directly with bogus JSON to exercise the parser error path.
    ctx.db.exec(
      `INSERT INTO turns (id, session_id, recorded_at_ms, summary, files_touched_json, decisions_json, learnings_json, tags_json, confidence, last_used_ms, use_count) VALUES ('${FIXED_TURN_UUID}', '${FIXED_SESSION_UUID}', ${String(ANCHOR_TIME_MS)}, 'S', 'not-json', '[]', '[]', '[]', 1, ${String(ANCHOR_TIME_MS)}, 0)`,
    );
    await expect(ctx.repo.findById(TurnId.from(FIXED_TURN_UUID))).rejects.toMatchObject(
      { code: "memory.persistence.row-malformed" },
    );
  });

  it("rejects rows with malformed JSON in decisions_json", async () => {
    ctx.db.exec(
      `INSERT INTO turns (id, session_id, recorded_at_ms, summary, files_touched_json, decisions_json, learnings_json, tags_json, confidence, last_used_ms, use_count) VALUES ('${FIXED_TURN_UUID}', '${FIXED_SESSION_UUID}', ${String(ANCHOR_TIME_MS)}, 'S', '[]', 'not-json', '[]', '[]', 1, ${String(ANCHOR_TIME_MS)}, 0)`,
    );
    await expect(ctx.repo.findById(TurnId.from(FIXED_TURN_UUID))).rejects.toMatchObject(
      { code: "memory.persistence.row-malformed" },
    );
  });

  it("rejects rows with malformed JSON in learnings_json", async () => {
    ctx.db.exec(
      `INSERT INTO turns (id, session_id, recorded_at_ms, summary, files_touched_json, decisions_json, learnings_json, tags_json, confidence, last_used_ms, use_count) VALUES ('${FIXED_TURN_UUID}', '${FIXED_SESSION_UUID}', ${String(ANCHOR_TIME_MS)}, 'S', '[]', '[]', 'not-json', '[]', 1, ${String(ANCHOR_TIME_MS)}, 0)`,
    );
    await expect(ctx.repo.findById(TurnId.from(FIXED_TURN_UUID))).rejects.toMatchObject(
      { code: "memory.persistence.row-malformed" },
    );
  });

  it("rejects rows with malformed tags_json", async () => {
    ctx.db.exec(
      `INSERT INTO turns (id, session_id, recorded_at_ms, summary, files_touched_json, decisions_json, learnings_json, tags_json, confidence, last_used_ms, use_count) VALUES ('${FIXED_TURN_UUID}', '${FIXED_SESSION_UUID}', ${String(ANCHOR_TIME_MS)}, 'S', '[]', '[]', '[]', 'not-json', 1, ${String(ANCHOR_TIME_MS)}, 0)`,
    );
    await expect(ctx.repo.findById(TurnId.from(FIXED_TURN_UUID))).rejects.toMatchObject(
      { code: "memory.persistence.row-malformed" },
    );
  });

  it("rejects malformed row schema (missing required column)", async () => {
    // Hand-craft a turn with NULL in non-nullable summary -> Zod will reject.
    ctx.db.exec(
      `INSERT INTO turns (id, session_id, recorded_at_ms, summary, files_touched_json, decisions_json, learnings_json, tags_json, confidence, last_used_ms, use_count) VALUES ('${FIXED_TURN_UUID}', '${FIXED_SESSION_UUID}', ${String(ANCHOR_TIME_MS)}, '', '[]', '[]', '[]', '[]', 1, ${String(ANCHOR_TIME_MS)}, 0)`,
    );
    await expect(ctx.repo.findById(TurnId.from(FIXED_TURN_UUID))).rejects.toMatchObject(
      { code: "memory.persistence.row-malformed" },
    );
  });
});
