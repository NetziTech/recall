import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteMemoryWiper } from "../../../../src/modules/memory/infrastructure/persistence/sqlite-memory-wiper.ts";
import { SqliteDecisionRepository } from "../../../../src/modules/memory/infrastructure/persistence/sqlite-decision-repository.ts";
import { SqliteSessionRepository } from "../../../../src/modules/memory/infrastructure/persistence/sqlite-session-repository.ts";
import { Decision } from "../../../../src/modules/memory/domain/aggregates/decision.ts";
import { Session } from "../../../../src/modules/memory/domain/aggregates/session.ts";
import { DecisionId } from "../../../../src/modules/memory/domain/value-objects/decision-id.ts";
import { SessionId } from "../../../../src/modules/memory/domain/value-objects/session-id.ts";
import { DecisionTitle } from "../../../../src/modules/memory/domain/value-objects/decision-title.ts";
import { DecisionContent } from "../../../../src/modules/memory/domain/value-objects/decision-content.ts";
import { Rationale } from "../../../../src/modules/memory/domain/value-objects/rationale.ts";
import { Scope } from "../../../../src/modules/memory/domain/value-objects/scope.ts";
import { EmbeddingStatus } from "../../../../src/modules/memory/domain/value-objects/embedding-status.ts";
import { Confidence } from "../../../../src/shared/domain/value-objects/confidence.ts";
import { WorkspaceId } from "../../../../src/shared/domain/value-objects/workspace-id.ts";
import { newMemoryDatabase } from "../../../_fixtures/memory-database.ts";
import {
  FIXED_DECISION_UUID,
  FIXED_SESSION_UUID,
  makeTags,
  makeTimestamp,
  makeWorkspaceId,
} from "../../../helpers/factories.ts";

const OTHER_WS = "01952f3c-2222-7000-8000-aaaaaaaaaa99";

interface Ctx {
  db: Awaited<ReturnType<typeof newMemoryDatabase>>;
  wiper: SqliteMemoryWiper;
}
let ctx: Ctx;

beforeEach(async () => {
  const db = await newMemoryDatabase();
  ctx = { db, wiper: new SqliteMemoryWiper(db, makeWorkspaceId()) };
});
afterEach(() => {
  ctx.db.close();
});

describe("SqliteMemoryWiper.wipe", () => {
  it("returns rowsDeleted=0 on empty workspace", async () => {
    const out = await ctx.wiper.wipe({ workspaceId: makeWorkspaceId() });
    expect(out.rowsDeleted).toBe(0);
  });

  it("deletes everything, transaction commits", async () => {
    const decRepo = new SqliteDecisionRepository(ctx.db, makeWorkspaceId());
    const sessRepo = new SqliteSessionRepository(ctx.db, makeWorkspaceId());
    const d = Decision.record({
      id: DecisionId.from(FIXED_DECISION_UUID),
      workspaceId: makeWorkspaceId(),
      sessionId: null,
      title: DecisionTitle.from("D"),
      rationale: Rationale.from("R"),
      content: DecisionContent.from("body"),
      tags: makeTags(),
      confidence: Confidence.full(),
      scope: Scope.project(),
      embeddingStatus: EmbeddingStatus.pending(),
      occurredAt: makeTimestamp(),
    });
    d.pullEvents();
    await decRepo.save(d);
    const s = Session.start({
      id: SessionId.from(FIXED_SESSION_UUID),
      workspaceId: makeWorkspaceId(),
      startedAt: makeTimestamp(),
      intent: null,
      resumedFrom: null,
    });
    s.pullEvents();
    await sessRepo.save(s);

    const out = await ctx.wiper.wipe({ workspaceId: makeWorkspaceId() });
    expect(out.rowsDeleted).toBeGreaterThan(0);
    const remaining = await decRepo.findById(DecisionId.from(FIXED_DECISION_UUID));
    expect(remaining).toBe(null);
  });

  it("rejects mismatched workspace id", async () => {
    await expect(
      ctx.wiper.wipe({ workspaceId: WorkspaceId.from(OTHER_WS) }),
    ).rejects.toMatchObject({
      code: "memory.persistence.delete-failed",
    });
  });
});
