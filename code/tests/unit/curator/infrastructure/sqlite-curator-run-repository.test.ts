import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteCuratorRunRepository } from "../../../../src/modules/curator/infrastructure/persistence/sqlite-curator-run-repository.ts";
import { CuratorInfrastructureError } from "../../../../src/modules/curator/infrastructure/errors/curator-infrastructure-error.ts";
import { CuratorRun } from "../../../../src/modules/curator/domain/aggregates/curator-run.ts";
import { CuratorRunId } from "../../../../src/modules/curator/domain/value-objects/curator-run-id.ts";
import { CuratorRunStats } from "../../../../src/modules/curator/domain/value-objects/curator-run-stats.ts";
import { CuratorRunTrigger } from "../../../../src/modules/curator/domain/value-objects/curator-run-trigger.ts";
import { Timestamp } from "../../../../src/shared/domain/value-objects/timestamp.ts";
import {
  ANCHOR_TIME_MS,
  FIXED_CURATOR_RUN_UUID,
  makeWorkspaceId,
} from "../../../helpers/factories.ts";
import { InMemoryDatabase } from "../../../_fixtures/in-memory-database.ts";

const SECOND_RUN_UUID = "01952f3c-eeee-7000-8000-000000000001";
const THIRD_RUN_UUID = "01952f3c-eeee-7000-8000-000000000002";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS curator_runs (
    id                       TEXT    PRIMARY KEY,
    workspace_id             TEXT    NOT NULL,
    trigger                  TEXT    NOT NULL CHECK (trigger IN ('scheduled', 'manual', 'session_close')),
    started_at_ms            INTEGER NOT NULL,
    ended_at_ms              INTEGER,
    entries_scanned          INTEGER NOT NULL DEFAULT 0,
    entries_decayed          INTEGER NOT NULL DEFAULT 0,
    entries_pruned           INTEGER NOT NULL DEFAULT 0,
    learnings_consolidated   INTEGER NOT NULL DEFAULT 0,
    paths_corrected          INTEGER NOT NULL DEFAULT 0,
    embeddings_requeued      INTEGER NOT NULL DEFAULT 0,
    open_questions_aged      INTEGER NOT NULL DEFAULT 0,
    duration_ms              INTEGER NOT NULL DEFAULT 0
);
`;

let db: InMemoryDatabase;
let repo: SqliteCuratorRunRepository;

beforeEach(() => {
  db = new InMemoryDatabase();
  db.exec(SCHEMA);
  repo = new SqliteCuratorRunRepository(db);
});

afterEach(() => {
  db.close();
});

function makeRunningRun(id: string, startedMs: number = ANCHOR_TIME_MS): CuratorRun {
  return CuratorRun.start({
    id: CuratorRunId.from(id),
    workspaceId: makeWorkspaceId(),
    trigger: CuratorRunTrigger.scheduled(),
    occurredAt: Timestamp.fromEpochMs(startedMs),
  });
}

describe("SqliteCuratorRunRepository", () => {
  it("save then findById round-trips a running run", async () => {
    const run = makeRunningRun(FIXED_CURATOR_RUN_UUID);
    await repo.save(run);
    const fetched = await repo.findById(CuratorRunId.from(FIXED_CURATOR_RUN_UUID));
    expect(fetched).not.toBeNull();
    expect(fetched?.getId().toString()).toBe(FIXED_CURATOR_RUN_UUID);
    expect(fetched?.isCompleted()).toBe(false);
    expect(fetched?.getStartedAt().toEpochMs()).toBe(ANCHOR_TIME_MS);
  });

  it("save is upsert (idempotent on the same id)", async () => {
    const run = makeRunningRun(FIXED_CURATOR_RUN_UUID);
    await repo.save(run);
    run.complete({
      finalStats: CuratorRunStats.empty().with({ entriesScanned: 7 }),
      occurredAt: Timestamp.fromEpochMs(ANCHOR_TIME_MS + 1000),
    });
    await repo.save(run);
    const fetched = await repo.findById(CuratorRunId.from(FIXED_CURATOR_RUN_UUID));
    expect(fetched?.isCompleted()).toBe(true);
    expect(fetched?.getStats().getEntriesScanned()).toBe(7);
  });

  it("findById returns null when no row exists", async () => {
    const fetched = await repo.findById(CuratorRunId.from(FIXED_CURATOR_RUN_UUID));
    expect(fetched).toBeNull();
  });

  it("findRecentByWorkspace returns rows ordered by started_at_ms DESC", async () => {
    const r1 = makeRunningRun(FIXED_CURATOR_RUN_UUID, ANCHOR_TIME_MS);
    const r2 = makeRunningRun(SECOND_RUN_UUID, ANCHOR_TIME_MS + 1000);
    const r3 = makeRunningRun(THIRD_RUN_UUID, ANCHOR_TIME_MS + 2000);
    await repo.save(r1);
    await repo.save(r2);
    await repo.save(r3);
    const list = await repo.findRecentByWorkspace(makeWorkspaceId(), 10);
    expect(list.length).toBe(3);
    // Order: most recent first.
    expect(list[0]?.getId().toString()).toBe(THIRD_RUN_UUID);
    expect(list[1]?.getId().toString()).toBe(SECOND_RUN_UUID);
    expect(list[2]?.getId().toString()).toBe(FIXED_CURATOR_RUN_UUID);
  });

  it("findRecentByWorkspace honours the limit", async () => {
    const r1 = makeRunningRun(FIXED_CURATOR_RUN_UUID, ANCHOR_TIME_MS);
    const r2 = makeRunningRun(SECOND_RUN_UUID, ANCHOR_TIME_MS + 1000);
    await repo.save(r1);
    await repo.save(r2);
    const list = await repo.findRecentByWorkspace(makeWorkspaceId(), 1);
    expect(list.length).toBe(1);
    expect(list[0]?.getId().toString()).toBe(SECOND_RUN_UUID);
  });

  it("findRecentByWorkspace returns empty list when none exist", async () => {
    const list = await repo.findRecentByWorkspace(makeWorkspaceId(), 5);
    expect(list.length).toBe(0);
  });

  it("findRecentByWorkspace rejects non-positive limit", async () => {
    await expect(
      repo.findRecentByWorkspace(makeWorkspaceId(), 0),
    ).rejects.toThrow(CuratorInfrastructureError);
    await expect(
      repo.findRecentByWorkspace(makeWorkspaceId(), -1),
    ).rejects.toThrow(CuratorInfrastructureError);
    await expect(
      repo.findRecentByWorkspace(makeWorkspaceId(), 1.5),
    ).rejects.toThrow(CuratorInfrastructureError);
  });

  it("findLastByWorkspace returns the most recent row", async () => {
    const r1 = makeRunningRun(FIXED_CURATOR_RUN_UUID, ANCHOR_TIME_MS);
    const r2 = makeRunningRun(SECOND_RUN_UUID, ANCHOR_TIME_MS + 1000);
    await repo.save(r1);
    await repo.save(r2);
    const last = await repo.findLastByWorkspace(makeWorkspaceId());
    expect(last?.getId().toString()).toBe(SECOND_RUN_UUID);
  });

  it("findLastByWorkspace returns null when none exist", async () => {
    const last = await repo.findLastByWorkspace(makeWorkspaceId());
    expect(last).toBeNull();
  });

  it("rehydrates a completed run with its stats counters", async () => {
    const run = makeRunningRun(FIXED_CURATOR_RUN_UUID);
    run.complete({
      finalStats: CuratorRunStats.empty().with({
        entriesScanned: 10,
        entriesDecayed: 5,
        entriesPruned: 2,
        learningsConsolidated: 1,
        pathsCorrected: 3,
        embeddingsRequeued: 4,
        openQuestionsAged: 6,
        durationMs: 250,
      }),
      occurredAt: Timestamp.fromEpochMs(ANCHOR_TIME_MS + 250),
    });
    await repo.save(run);
    const fetched = await repo.findById(CuratorRunId.from(FIXED_CURATOR_RUN_UUID));
    expect(fetched?.isCompleted()).toBe(true);
    const stats = fetched?.getStats();
    expect(stats?.getEntriesScanned()).toBe(10);
    expect(stats?.getEntriesDecayed()).toBe(5);
    expect(stats?.getEntriesPruned()).toBe(2);
    expect(stats?.getLearningsConsolidated()).toBe(1);
    expect(stats?.getPathsCorrected()).toBe(3);
    expect(stats?.getEmbeddingsRequeued()).toBe(4);
    expect(stats?.getOpenQuestionsAged()).toBe(6);
    expect(stats?.getDurationMs()).toBe(250);
    expect(fetched?.getEndedAt()?.toEpochMs()).toBe(ANCHOR_TIME_MS + 250);
  });

  it("raises CuratorInfrastructureError.rowMalformed on a corrupt row", async () => {
    // Insert a row whose started_at_ms violates the Zod row schema
    // (negative integer rejected by `z.number().int().min(0)`).
    const validId = "01952f3c-eeee-7000-8000-000000000bad";
    const badStmt = db.prepare(
      `INSERT INTO curator_runs (
        id, workspace_id, trigger, started_at_ms, ended_at_ms,
        entries_scanned, entries_decayed, entries_pruned, learnings_consolidated,
        paths_corrected, embeddings_requeued, open_questions_aged, duration_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    badStmt.run(
      validId,
      "ws-bad",
      "scheduled",
      -10, // negative started_at_ms is rejected by Zod schema
      null,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
    );
    await expect(
      repo.findById(CuratorRunId.from(validId)),
    ).rejects.toThrow(CuratorInfrastructureError);
  });
});
