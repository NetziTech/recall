import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SqliteMemoryProjectionRepository } from "../../../../src/modules/retrieval/infrastructure/persistence/sqlite-memory-projection-repository.ts";
import { Timestamp } from "../../../../src/shared/domain/value-objects/timestamp.ts";
import { ANCHOR_TIME_MS, FIXED_WORKSPACE_UUID, makeWorkspaceId } from "../../../helpers/factories.ts";
import { InMemoryDatabase } from "../../../_fixtures/in-memory-database.ts";

const SCHEMA = `
  CREATE TABLE workspace_config (
      workspace_id  TEXT PRIMARY KEY,
      display_name  TEXT NOT NULL,
      mode          TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}'
  );
  CREATE TABLE sessions (
      id              TEXT    PRIMARY KEY,
      started_at_ms   INTEGER NOT NULL,
      ended_at_ms     INTEGER,
      intent          TEXT,
      summary         TEXT,
      next_seed       TEXT,
      resumed_from    TEXT,
      turns_count     INTEGER NOT NULL DEFAULT 0,
      metadata_json   TEXT    NOT NULL DEFAULT '{}'
  );
  CREATE TABLE turns (
      id                  TEXT    PRIMARY KEY,
      session_id          TEXT    NOT NULL,
      recorded_at_ms      INTEGER NOT NULL,
      summary             TEXT    NOT NULL,
      intent              TEXT,
      outcome             TEXT,
      tags_json           TEXT    NOT NULL DEFAULT '[]',
      confidence          REAL    NOT NULL DEFAULT 1.0,
      last_used_ms        INTEGER NOT NULL,
      use_count           INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE decisions (
      id              TEXT    PRIMARY KEY,
      title           TEXT    NOT NULL,
      rationale       TEXT    NOT NULL,
      scope           TEXT    NOT NULL,
      module          TEXT,
      tags_json       TEXT    NOT NULL DEFAULT '[]',
      confidence      REAL    NOT NULL DEFAULT 1.0,
      created_at_ms   INTEGER NOT NULL,
      last_used_ms    INTEGER NOT NULL,
      use_count       INTEGER NOT NULL DEFAULT 0,
      superseded_by   TEXT
  );
  CREATE TABLE learnings (
      id              TEXT    PRIMARY KEY,
      content         TEXT    NOT NULL,
      trigger         TEXT,
      scope           TEXT    NOT NULL,
      module          TEXT,
      severity        TEXT    NOT NULL,
      tags_json       TEXT    NOT NULL DEFAULT '[]',
      confidence      REAL    NOT NULL DEFAULT 1.0,
      created_at_ms   INTEGER NOT NULL,
      last_used_ms    INTEGER NOT NULL,
      use_count       INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE entities (
      id              TEXT    PRIMARY KEY,
      name            TEXT    NOT NULL,
      entity_kind     TEXT    NOT NULL,
      description     TEXT    NOT NULL DEFAULT '',
      location        TEXT,
      tags_json       TEXT    NOT NULL DEFAULT '[]',
      confidence      REAL    NOT NULL DEFAULT 1.0,
      created_at_ms   INTEGER NOT NULL,
      last_used_ms    INTEGER NOT NULL,
      use_count       INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE tasks (
      id              TEXT    PRIMARY KEY,
      title           TEXT    NOT NULL,
      description     TEXT,
      status          TEXT    NOT NULL,
      priority        TEXT    NOT NULL,
      tags_json       TEXT    NOT NULL DEFAULT '[]',
      created_at_ms   INTEGER NOT NULL,
      updated_at_ms   INTEGER NOT NULL
  );
`;

const seed = (db: InMemoryDatabase): void => {
  db.exec(SCHEMA);

  db.prepare(
    "INSERT INTO workspace_config (workspace_id, display_name, mode, metadata_json) VALUES (?, ?, ?, ?)",
  ).run(
    FIXED_WORKSPACE_UUID,
    "My Project",
    "shared",
    JSON.stringify({ language: "typescript" }),
  );

  db.prepare(
    "INSERT INTO sessions (id, started_at_ms, ended_at_ms, intent, metadata_json) VALUES (?, ?, ?, ?, ?)",
  ).run(
    "01952f3c-2222-7000-8000-555555555555",
    ANCHOR_TIME_MS,
    null,
    "Refactor the auth flow",
    "{}",
  );

  // Add a closed session with open_questions in metadata.
  db.prepare(
    "INSERT INTO sessions (id, started_at_ms, ended_at_ms, intent, metadata_json) VALUES (?, ?, ?, ?, ?)",
  ).run(
    "01952f3c-2222-7000-8000-666666666666",
    ANCHOR_TIME_MS - 10_000,
    ANCHOR_TIME_MS - 5000,
    null,
    JSON.stringify({
      open_questions: [
        { text: "Why does X happen?", askedAt: ANCHOR_TIME_MS - 5500 },
        "Plain string question",
      ],
    }),
  );

  db.prepare(
    "INSERT INTO decisions (id, title, rationale, scope, module, tags_json, confidence, created_at_ms, last_used_ms, use_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    "01952f3b-7d8c-7000-8000-d00000000001",
    "Use Postgres",
    "We picked Postgres because of JSONB support",
    "project",
    null,
    "[]",
    1.0,
    ANCHOR_TIME_MS,
    ANCHOR_TIME_MS,
    5,
  );
  db.prepare(
    "INSERT INTO decisions (id, title, rationale, scope, module, tags_json, confidence, created_at_ms, last_used_ms, use_count, superseded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    "01952f3b-7d8c-7000-8000-d00000000002",
    "Old decision",
    "Was replaced",
    "project",
    null,
    "[]",
    1.0,
    ANCHOR_TIME_MS,
    ANCHOR_TIME_MS,
    0,
    "01952f3b-7d8c-7000-8000-d00000000001",
  );

  db.prepare(
    "INSERT INTO learnings (id, content, trigger, scope, module, severity, tags_json, confidence, created_at_ms, last_used_ms, use_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    "01952f3b-7d8c-7000-8000-d00000000010",
    "CASCADE deletes can lock the table",
    "schema migration",
    "project",
    null,
    "warning",
    "[]",
    1.0,
    ANCHOR_TIME_MS,
    ANCHOR_TIME_MS,
    0,
  );

  db.prepare(
    "INSERT INTO entities (id, name, entity_kind, description, location, tags_json, confidence, created_at_ms, last_used_ms, use_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    "01952f3b-7d8c-7000-8000-d00000000020",
    "UserService",
    "service",
    "Handles auth via tokens",
    "/src/services/user-service.ts",
    "[]",
    1.0,
    ANCHOR_TIME_MS,
    ANCHOR_TIME_MS,
    0,
  );

  db.prepare(
    "INSERT INTO tasks (id, title, description, status, priority, tags_json, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    "01952f3b-7d8c-7000-8000-d00000000030",
    "Add token refresh",
    "Refresh on 401",
    "todo",
    "high",
    "[]",
    ANCHOR_TIME_MS,
    ANCHOR_TIME_MS,
  );
  db.prepare(
    "INSERT INTO tasks (id, title, description, status, priority, tags_json, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    "01952f3b-7d8c-7000-8000-d00000000031",
    "Done already",
    null,
    "done",
    "low",
    "[]",
    ANCHOR_TIME_MS,
    ANCHOR_TIME_MS,
  );

  db.prepare(
    "INSERT INTO turns (id, session_id, recorded_at_ms, summary, intent, outcome, last_used_ms, use_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    "01952f3b-7d8c-7000-8000-d00000000040",
    "01952f3c-2222-7000-8000-555555555555",
    ANCHOR_TIME_MS,
    "Discussed migration",
    "plan",
    "approved",
    ANCHOR_TIME_MS,
    0,
  );
};

let db: InMemoryDatabase;
let repo: SqliteMemoryProjectionRepository;

beforeEach(() => {
  db = new InMemoryDatabase();
  seed(db);
  repo = new SqliteMemoryProjectionRepository(db);
});

afterEach(() => {
  db.close();
});

describe("SqliteMemoryProjectionRepository", () => {
  it("loadWorkspaceAnchor returns the workspace config when present", async () => {
    const anchor = await repo.loadWorkspaceAnchor(makeWorkspaceId());
    expect(anchor).not.toBeNull();
    expect(anchor?.displayName.toString()).toBe("My Project");
    expect(anchor?.mode).toBe("shared");
    expect(anchor?.activeSessionId?.toString()).toBe(
      "01952f3c-2222-7000-8000-555555555555",
    );
  });

  it("loadWorkspaceAnchor returns null for an unknown workspace", async () => {
    db.exec("DELETE FROM workspace_config");
    const anchor = await repo.loadWorkspaceAnchor(makeWorkspaceId());
    expect(anchor).toBeNull();
  });

  it("loadWorkspaceAnchor returns null when mode is not a valid label", async () => {
    db.exec(
      "UPDATE workspace_config SET mode = 'invalid' WHERE workspace_id = '" +
        FIXED_WORKSPACE_UUID +
        "'",
    );
    const anchor = await repo.loadWorkspaceAnchor(makeWorkspaceId());
    expect(anchor).toBeNull();
  });

  it("listActiveDecisions excludes superseded decisions", async () => {
    const out = await repo.listActiveDecisions({
      workspaceId: makeWorkspaceId(),
      limit: 10,
    });
    expect(out.length).toBe(1);
    expect(out[0]?.title.toString()).toBe("Use Postgres");
  });

  it("listActiveDecisions respects the limit", async () => {
    const out = await repo.listActiveDecisions({
      workspaceId: makeWorkspaceId(),
      limit: 0,
    });
    expect(out.length).toBe(0);
  });

  it("listOpenTasks excludes done tasks", async () => {
    const out = await repo.listOpenTasks({
      workspaceId: makeWorkspaceId(),
      limit: 10,
    });
    expect(out.length).toBe(1);
    expect(out[0]?.title.toString()).toBe("Add token refresh");
  });

  it("listRecentTurns returns turns ordered DESC by recorded_at_ms", async () => {
    db.prepare(
      "INSERT INTO turns (id, session_id, recorded_at_ms, summary, last_used_ms, use_count) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(
      "01952f3b-7d8c-7000-8000-d00000000041",
      "01952f3c-2222-7000-8000-555555555555",
      ANCHOR_TIME_MS + 1000,
      "More recent",
      ANCHOR_TIME_MS,
      0,
    );

    const out = await repo.listRecentTurns({
      workspaceId: makeWorkspaceId(),
      limit: 10,
    });

    expect(out.length).toBe(2);
    expect(out[0]?.summary.toString()).toBe("More recent");
  });

  it("listOpenQuestions parses both rich and bare-string forms", async () => {
    const out = await repo.listOpenQuestions({
      workspaceId: makeWorkspaceId(),
      sessionLimit: 5,
      limit: 10,
    });
    expect(out.length).toBe(2);
    const texts = out.map((q) => q.question.text.toString());
    expect(texts).toContain("Why does X happen?");
    expect(texts).toContain("Plain string question");
  });

  it("listOpenQuestions respects the limit", async () => {
    const out = await repo.listOpenQuestions({
      workspaceId: makeWorkspaceId(),
      sessionLimit: 5,
      limit: 1,
    });
    expect(out.length).toBe(1);
  });

  it("loadProjectionsByHits returns one projection per (kind, id)", async () => {
    const out = await repo.loadProjectionsByHits({
      workspaceId: makeWorkspaceId(),
      hits: [
        { kind: "decision", id: "01952f3b-7d8c-7000-8000-d00000000001" },
        { kind: "learning", id: "01952f3b-7d8c-7000-8000-d00000000010" },
        { kind: "entity", id: "01952f3b-7d8c-7000-8000-d00000000020" },
        { kind: "task", id: "01952f3b-7d8c-7000-8000-d00000000030" },
        { kind: "turn", id: "01952f3b-7d8c-7000-8000-d00000000040" },
      ],
    });

    expect(out.length).toBe(5);
    const kinds = out.map((p) => p.kind);
    expect(kinds).toEqual(["decision", "learning", "entity", "task", "turn"]);
  });

  it("loadProjectionsByHits silently drops missing rows", async () => {
    const out = await repo.loadProjectionsByHits({
      workspaceId: makeWorkspaceId(),
      hits: [
        { kind: "decision", id: "missing-id" },
        { kind: "decision", id: "01952f3b-7d8c-7000-8000-d00000000001" },
      ],
    });
    expect(out.length).toBe(1);
  });

  it("loadProjectionsByHits returns frozen empty array on empty input", async () => {
    const out = await repo.loadProjectionsByHits({
      workspaceId: makeWorkspaceId(),
      hits: [],
    });
    expect(out.length).toBe(0);
    expect(Object.isFrozen(out)).toBe(true);
  });

  it("loadEntityRefsByIds returns refs for known ids", async () => {
    const out = await repo.loadEntityRefsByIds({
      workspaceId: makeWorkspaceId(),
      ids: ["01952f3b-7d8c-7000-8000-d00000000020"],
    });
    expect(out.length).toBe(1);
    expect(out[0]?.name.toString()).toBe("UserService");
  });

  it("loadEntityRefsByIds returns empty for empty input", async () => {
    const out = await repo.loadEntityRefsByIds({
      workspaceId: makeWorkspaceId(),
      ids: [],
    });
    expect(out.length).toBe(0);
  });

  it("bumpUsage increments use_count and updates last_used_ms transactionally", async () => {
    await repo.bumpUsage({
      workspaceId: makeWorkspaceId(),
      touched: [
        { kind: "decision", id: "01952f3b-7d8c-7000-8000-d00000000001" },
        { kind: "learning", id: "01952f3b-7d8c-7000-8000-d00000000010" },
      ],
      at: Timestamp.fromEpochMs(ANCHOR_TIME_MS + 5000),
    });

    const dec = db
      .prepare(
        "SELECT use_count, last_used_ms FROM decisions WHERE id = ?",
      )
      .get("01952f3b-7d8c-7000-8000-d00000000001") as {
      use_count: number;
      last_used_ms: number;
    };
    expect(dec.use_count).toBe(6); // was 5
    expect(dec.last_used_ms).toBe(ANCHOR_TIME_MS + 5000);

    const learn = db
      .prepare(
        "SELECT use_count, last_used_ms FROM learnings WHERE id = ?",
      )
      .get("01952f3b-7d8c-7000-8000-d00000000010") as {
      use_count: number;
      last_used_ms: number;
    };
    expect(learn.use_count).toBe(1);
    expect(learn.last_used_ms).toBe(ANCHOR_TIME_MS + 5000);
  });

  it("bumpUsage with empty touched is a no-op", async () => {
    await expect(
      repo.bumpUsage({
        workspaceId: makeWorkspaceId(),
        touched: [],
        at: Timestamp.fromEpochMs(ANCHOR_TIME_MS),
      }),
    ).resolves.toBeUndefined();
  });

  it("loadProjectionsByHits truncates long previews on decision rationale", async () => {
    db.prepare(
      "INSERT INTO decisions (id, title, rationale, scope, module, tags_json, confidence, created_at_ms, last_used_ms, use_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      "01952f3b-7d8c-7000-8000-d00000000099",
      "Big Decision",
      "X".repeat(2000),
      "project",
      null,
      "[]",
      1.0,
      ANCHOR_TIME_MS,
      ANCHOR_TIME_MS,
      0,
    );

    const out = await repo.loadProjectionsByHits({
      workspaceId: makeWorkspaceId(),
      hits: [{ kind: "decision", id: "01952f3b-7d8c-7000-8000-d00000000099" }],
    });

    expect(out.length).toBe(1);
    expect(out[0]?.preview.length).toBeLessThanOrEqual(600);
  });

  it("loadProjectionsByHits picks first 80 chars of a long single-line learning", async () => {
    const longLine = "L".repeat(500);
    db.prepare(
      "INSERT INTO learnings (id, content, trigger, scope, module, severity, tags_json, confidence, created_at_ms, last_used_ms, use_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      "01952f3b-7d8c-7000-8000-d000000000a1",
      longLine,
      null,
      "project",
      null,
      "warning",
      "[]",
      1.0,
      ANCHOR_TIME_MS,
      ANCHOR_TIME_MS,
      0,
    );

    const out = await repo.loadProjectionsByHits({
      workspaceId: makeWorkspaceId(),
      hits: [{ kind: "learning", id: "01952f3b-7d8c-7000-8000-d000000000a1" }],
    });

    expect(out.length).toBe(1);
    expect(out[0]?.title.length).toBeLessThanOrEqual(80);
  });

  it("loadProjectionsByHits handles a turn whose summary first line is empty", async () => {
    db.prepare(
      "INSERT INTO turns (id, session_id, recorded_at_ms, summary, last_used_ms, use_count) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(
      "01952f3b-7d8c-7000-8000-d000000000a2",
      "01952f3c-2222-7000-8000-555555555555",
      ANCHOR_TIME_MS,
      "    \nWith content after newline",
      ANCHOR_TIME_MS,
      0,
    );

    const out = await repo.loadProjectionsByHits({
      workspaceId: makeWorkspaceId(),
      hits: [{ kind: "turn", id: "01952f3b-7d8c-7000-8000-d000000000a2" }],
    });

    expect(out.length).toBe(1);
    expect(out[0]?.title).toBeDefined();
  });

  it("loadProjectionsByHits handles unknown severity gracefully (defaults to tip)", async () => {
    db.prepare(
      "INSERT INTO learnings (id, content, trigger, scope, module, severity, tags_json, confidence, created_at_ms, last_used_ms, use_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      "01952f3b-7d8c-7000-8000-d000000000a3",
      "Some content",
      null,
      "project",
      null,
      "unknown-severity-value",
      "[]",
      1.0,
      ANCHOR_TIME_MS,
      ANCHOR_TIME_MS,
      0,
    );

    const out = await repo.loadProjectionsByHits({
      workspaceId: makeWorkspaceId(),
      hits: [{ kind: "learning", id: "01952f3b-7d8c-7000-8000-d000000000a3" }],
    });

    expect(out.length).toBe(1);
    expect(out[0]?.severity).not.toBeNull();
  });

  it("loadProjectionsByHits hydrates entity with empty description correctly", async () => {
    db.prepare(
      "INSERT INTO entities (id, name, entity_kind, description, location, tags_json, confidence, created_at_ms, last_used_ms, use_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      "01952f3b-7d8c-7000-8000-d000000000a4",
      "EmptyDescEntity",
      "service",
      "",
      null,
      "[]",
      1.0,
      ANCHOR_TIME_MS,
      ANCHOR_TIME_MS,
      0,
    );

    const out = await repo.loadProjectionsByHits({
      workspaceId: makeWorkspaceId(),
      hits: [{ kind: "entity", id: "01952f3b-7d8c-7000-8000-d000000000a4" }],
    });

    expect(out.length).toBe(1);
    expect(out[0]?.preview).toContain("EmptyDescEntity");
  });

  it("loadProjectionsByHits hydrates task with null description (uses status fallback)", async () => {
    db.prepare(
      "INSERT INTO tasks (id, title, description, status, priority, tags_json, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      "01952f3b-7d8c-7000-8000-d000000000a5",
      "TaskNoDesc",
      null,
      "in_progress",
      "low",
      "[]",
      ANCHOR_TIME_MS,
      ANCHOR_TIME_MS,
    );

    const out = await repo.loadProjectionsByHits({
      workspaceId: makeWorkspaceId(),
      hits: [{ kind: "task", id: "01952f3b-7d8c-7000-8000-d000000000a5" }],
    });

    expect(out.length).toBe(1);
    expect(out[0]?.preview).toContain("TaskNoDesc");
  });

  it("loadOpenQuestions tolerates malformed metadata_json gracefully", async () => {
    db.prepare(
      "UPDATE sessions SET metadata_json = ? WHERE id = ?",
    ).run("not-valid-json{", "01952f3c-2222-7000-8000-666666666666");

    const out = await repo.listOpenQuestions({
      workspaceId: makeWorkspaceId(),
      sessionLimit: 5,
      limit: 10,
    });
    // Should not crash; the malformed session contributes 0 entries.
    expect(out).toEqual([]);
  });

  it("loadOpenQuestions returns empty for non-object metadata_json (parsed to null)", async () => {
    db.prepare(
      "UPDATE sessions SET metadata_json = ? WHERE id = ?",
    ).run("null", "01952f3c-2222-7000-8000-666666666666");

    const out = await repo.listOpenQuestions({
      workspaceId: makeWorkspaceId(),
      sessionLimit: 5,
      limit: 10,
    });
    expect(out).toEqual([]);
  });

  it("loadOpenQuestions returns empty when open_questions is not an array", async () => {
    db.prepare(
      "UPDATE sessions SET metadata_json = ? WHERE id = ?",
    ).run(
      JSON.stringify({ open_questions: "not-array" }),
      "01952f3c-2222-7000-8000-666666666666",
    );

    const out = await repo.listOpenQuestions({
      workspaceId: makeWorkspaceId(),
      sessionLimit: 5,
      limit: 10,
    });
    expect(out).toEqual([]);
  });

  it("loadOpenQuestions returns empty when open_questions schema fails", async () => {
    db.prepare(
      "UPDATE sessions SET metadata_json = ? WHERE id = ?",
    ).run(
      JSON.stringify({ open_questions: [{ wrongField: 42 }] }),
      "01952f3c-2222-7000-8000-666666666666",
    );

    const out = await repo.listOpenQuestions({
      workspaceId: makeWorkspaceId(),
      sessionLimit: 5,
      limit: 10,
    });
    expect(out).toEqual([]);
  });

  it("loadOpenQuestions tolerates non-string metadata values when parsing the workspace metadata", async () => {
    db.prepare(
      "UPDATE workspace_config SET metadata_json = ? WHERE workspace_id = ?",
    ).run(
      JSON.stringify({ language: "ts", count: 42, on: true, weird: null }),
      FIXED_WORKSPACE_UUID,
    );

    const anchor = await repo.loadWorkspaceAnchor(makeWorkspaceId());
    expect(anchor).not.toBeNull();
    // Numbers and booleans get coerced to strings; null is dropped.
    expect(anchor?.metadata.count).toBe("42");
    expect(anchor?.metadata.on).toBe("true");
    expect(anchor?.metadata.weird).toBeUndefined();
  });
});
