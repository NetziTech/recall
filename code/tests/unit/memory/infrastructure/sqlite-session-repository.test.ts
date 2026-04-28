import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteSessionRepository } from "../../../../src/modules/memory/infrastructure/persistence/sqlite-session-repository.ts";
import { Session } from "../../../../src/modules/memory/domain/aggregates/session.ts";
import { SessionId } from "../../../../src/modules/memory/domain/value-objects/session-id.ts";
import { SessionIntent } from "../../../../src/modules/memory/domain/value-objects/session-intent.ts";
import { SessionSummary } from "../../../../src/modules/memory/domain/value-objects/session-summary.ts";
import { SessionNextSeed } from "../../../../src/modules/memory/domain/value-objects/session-next-seed.ts";
import { OpenQuestionText } from "../../../../src/modules/memory/domain/value-objects/open-question.ts";
import { WorkspaceId } from "../../../../src/shared/domain/value-objects/workspace-id.ts";
import { newMemoryDatabase } from "../../../_fixtures/memory-database.ts";
import {
  ANCHOR_TIME_MS,
  FIXED_SESSION_UUID,
  makeTimestamp,
  makeWorkspaceId,
} from "../../../helpers/factories.ts";

const SECOND_SESSION_UUID = "01952f3c-2222-7000-8000-111111111102";
const OTHER_WS = "01952f3c-2222-7000-8000-aaaaaaaaaa99";

interface Ctx {
  db: Awaited<ReturnType<typeof newMemoryDatabase>>;
  repo: SqliteSessionRepository;
}
let ctx: Ctx;

beforeEach(async () => {
  const db = await newMemoryDatabase();
  ctx = { db, repo: new SqliteSessionRepository(db, makeWorkspaceId()) };
});
afterEach(() => {
  ctx.db.close();
});

function buildSession(args: {
  id: string;
  startedAtMs?: number;
  intent?: string | null;
}): Session {
  const s = Session.start({
    id: SessionId.from(args.id),
    workspaceId: makeWorkspaceId(),
    startedAt: makeTimestamp(args.startedAtMs ?? ANCHOR_TIME_MS),
    intent: args.intent === undefined || args.intent === null
      ? null
      : SessionIntent.from(args.intent),
    resumedFrom: null,
  });
  s.pullEvents();
  return s;
}

describe("SqliteSessionRepository CRUD", () => {
  it("save+findById round-trips intent, summary, nextSeed", async () => {
    const s = buildSession({ id: FIXED_SESSION_UUID, intent: "build feature" });
    s.setSummary({
      summary: SessionSummary.from("done"),
      occurredAt: makeTimestamp(ANCHOR_TIME_MS + 100),
    });
    s.setNextSeed({
      nextSeed: SessionNextSeed.from("next: review PRs"),
      occurredAt: makeTimestamp(ANCHOR_TIME_MS + 101),
    });
    s.pullEvents();
    await ctx.repo.save(s);
    const loaded = await ctx.repo.findById(SessionId.from(FIXED_SESSION_UUID));
    expect(loaded?.getIntent()?.toString()).toBe("build feature");
    expect(loaded?.getSummary()?.toString()).toBe("done");
    expect(loaded?.getNextSeed()?.toString()).toBe("next: review PRs");
  });

  it("persists ended_at on closed session", async () => {
    const s = buildSession({ id: FIXED_SESSION_UUID });
    s.end({ occurredAt: makeTimestamp(ANCHOR_TIME_MS + 1000) });
    s.pullEvents();
    await ctx.repo.save(s);
    const loaded = await ctx.repo.findById(SessionId.from(FIXED_SESSION_UUID));
    expect(loaded?.getEndedAt()?.toEpochMs()).toBe(ANCHOR_TIME_MS + 1000);
  });

  it("findById returns null on miss", async () => {
    expect(
      await ctx.repo.findById(SessionId.from(FIXED_SESSION_UUID)),
    ).toBe(null);
  });

  it("preserves open questions through metadata round-trip", async () => {
    const s = buildSession({ id: FIXED_SESSION_UUID });
    s.addOpenQuestion({
      text: OpenQuestionText.from("Where to put logger?"),
      occurredAt: makeTimestamp(ANCHOR_TIME_MS + 50),
    });
    s.pullEvents();
    await ctx.repo.save(s);
    const loaded = await ctx.repo.findById(SessionId.from(FIXED_SESSION_UUID));
    expect(loaded?.getMetadata().openQuestions.length).toBe(1);
    expect(loaded?.getMetadata().openQuestions[0]?.text.toString()).toBe(
      "Where to put logger?",
    );
  });
});

describe("SqliteSessionRepository queries", () => {
  it("findCurrentByWorkspace returns the open session", async () => {
    await ctx.repo.save(buildSession({ id: FIXED_SESSION_UUID }));
    const current = await ctx.repo.findCurrentByWorkspace(makeWorkspaceId());
    expect(current?.getId().toString()).toBe(FIXED_SESSION_UUID);
  });

  it("findCurrentByWorkspace returns null when no open session", async () => {
    const s = buildSession({ id: FIXED_SESSION_UUID });
    s.end({ occurredAt: makeTimestamp(ANCHOR_TIME_MS + 1000) });
    s.pullEvents();
    await ctx.repo.save(s);
    const current = await ctx.repo.findCurrentByWorkspace(makeWorkspaceId());
    expect(current).toBe(null);
  });

  it("findAllByWorkspace returns sessions ordered most-recent-first", async () => {
    await ctx.repo.save(
      buildSession({ id: FIXED_SESSION_UUID, startedAtMs: ANCHOR_TIME_MS }),
    );
    await ctx.repo.save(
      buildSession({
        id: SECOND_SESSION_UUID,
        startedAtMs: ANCHOR_TIME_MS + 1000,
      }),
    );
    const all = await ctx.repo.findAllByWorkspace(makeWorkspaceId());
    expect(all.length).toBe(2);
    expect(all[0]?.getId().toString()).toBe(SECOND_SESSION_UUID);
  });

  it("rejects mismatched workspace on findCurrentByWorkspace", async () => {
    await expect(
      ctx.repo.findCurrentByWorkspace(WorkspaceId.from(OTHER_WS)),
    ).rejects.toMatchObject({
      code: "memory.persistence.query-failed",
    });
  });

  it("rejects mismatched workspace on findAllByWorkspace", async () => {
    await expect(
      ctx.repo.findAllByWorkspace(WorkspaceId.from(OTHER_WS)),
    ).rejects.toMatchObject({
      code: "memory.persistence.query-failed",
    });
  });

  it("rejects rows with malformed metadata_json", async () => {
    ctx.db.exec(
      `INSERT INTO sessions (id, started_at_ms, turns_count, metadata_json) VALUES ('${FIXED_SESSION_UUID}', ${String(ANCHOR_TIME_MS)}, 0, 'not-json')`,
    );
    await expect(
      ctx.repo.findById(SessionId.from(FIXED_SESSION_UUID)),
    ).rejects.toMatchObject({ code: "memory.persistence.row-malformed" });
  });
});
