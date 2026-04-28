import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteSessionRollupReader } from "../../../../src/modules/curator/infrastructure/persistence/sqlite-session-rollup-reader.ts";
import { CuratorInfrastructureError } from "../../../../src/modules/curator/infrastructure/errors/curator-infrastructure-error.ts";
import {
  ANCHOR_TIME_MS,
  FIXED_SESSION_UUID,
  makeWorkspaceId,
} from "../../../helpers/factories.ts";
import { InMemoryDatabase } from "../../../_fixtures/in-memory-database.ts";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS turns (
    id                  TEXT    PRIMARY KEY,
    session_id          TEXT    NOT NULL,
    recorded_at_ms      INTEGER NOT NULL,
    summary             TEXT    NOT NULL,
    confidence          REAL    NOT NULL DEFAULT 1.0
);
`;

let db: InMemoryDatabase;
let reader: SqliteSessionRollupReader;

beforeEach(() => {
  db = new InMemoryDatabase();
  db.exec(SCHEMA);
  reader = new SqliteSessionRollupReader(db);
});

afterEach(() => {
  db.close();
});

function seedTurn(
  id: string,
  sessionId: string,
  options: {
    summary?: string;
    confidence?: number;
    recordedAtMs?: number;
  } = {},
): void {
  db.prepare(
    `INSERT INTO turns (id, session_id, recorded_at_ms, summary, confidence)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    id,
    sessionId,
    options.recordedAtMs ?? ANCHOR_TIME_MS,
    options.summary ?? `summary-${id}`,
    options.confidence ?? 0.5,
  );
}

const T1 = "01952f3d-0000-7000-8000-000000000001";
const T2 = "01952f3d-0000-7000-8000-000000000002";
const T3 = "01952f3d-0000-7000-8000-000000000003";

describe("SqliteSessionRollupReader.listTopTurns", () => {
  it("returns turns ordered by confidence DESC, recorded_at_ms ASC", async () => {
    seedTurn(T1, FIXED_SESSION_UUID, { confidence: 0.5, recordedAtMs: ANCHOR_TIME_MS });
    seedTurn(T2, FIXED_SESSION_UUID, { confidence: 0.9, recordedAtMs: ANCHOR_TIME_MS + 100 });
    seedTurn(T3, FIXED_SESSION_UUID, { confidence: 0.9, recordedAtMs: ANCHOR_TIME_MS + 50 });
    const out = await reader.listTopTurns({
      workspaceId: makeWorkspaceId(),
      sessionId: FIXED_SESSION_UUID,
      limit: 5,
    });
    expect(out.map((t) => t.turnId)).toEqual([T3, T2, T1]);
  });

  it("honours the limit", async () => {
    seedTurn(T1, FIXED_SESSION_UUID, { confidence: 0.9 });
    seedTurn(T2, FIXED_SESSION_UUID, { confidence: 0.5 });
    const out = await reader.listTopTurns({
      workspaceId: makeWorkspaceId(),
      sessionId: FIXED_SESSION_UUID,
      limit: 1,
    });
    expect(out.length).toBe(1);
    expect(out[0]?.turnId).toBe(T1);
  });

  it("returns empty when session has no turns", async () => {
    const out = await reader.listTopTurns({
      workspaceId: makeWorkspaceId(),
      sessionId: FIXED_SESSION_UUID,
      limit: 5,
    });
    expect(out.length).toBe(0);
  });

  it("filters by session_id (does not leak cross-session)", async () => {
    seedTurn(T1, FIXED_SESSION_UUID);
    seedTurn(T2, "01952f3d-0000-7000-8000-eeeeeeeeeeee");
    const out = await reader.listTopTurns({
      workspaceId: makeWorkspaceId(),
      sessionId: FIXED_SESSION_UUID,
      limit: 10,
    });
    expect(out.length).toBe(1);
    expect(out[0]?.turnId).toBe(T1);
  });

  it("rejects non-positive limit", async () => {
    await expect(
      reader.listTopTurns({
        workspaceId: makeWorkspaceId(),
        sessionId: FIXED_SESSION_UUID,
        limit: 0,
      }),
    ).rejects.toThrow(CuratorInfrastructureError);
    await expect(
      reader.listTopTurns({
        workspaceId: makeWorkspaceId(),
        sessionId: FIXED_SESSION_UUID,
        limit: -3,
      }),
    ).rejects.toThrow(CuratorInfrastructureError);
    await expect(
      reader.listTopTurns({
        workspaceId: makeWorkspaceId(),
        sessionId: FIXED_SESSION_UUID,
        limit: 2.5,
      }),
    ).rejects.toThrow(CuratorInfrastructureError);
  });

  it("raises rowMalformed when a row violates the Zod schema", async () => {
    db.prepare(
      `INSERT INTO turns (id, session_id, recorded_at_ms, summary, confidence) VALUES (?, ?, ?, ?, ?)`,
    ).run(T1, FIXED_SESSION_UUID, -10, "summary", 0.5); // negative recorded_at_ms
    await expect(
      reader.listTopTurns({
        workspaceId: makeWorkspaceId(),
        sessionId: FIXED_SESSION_UUID,
        limit: 5,
      }),
    ).rejects.toThrow(CuratorInfrastructureError);
  });
});
