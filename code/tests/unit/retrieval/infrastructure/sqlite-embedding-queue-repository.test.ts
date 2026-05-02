/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3-multiple-ciphers";
import * as sqliteVec from "sqlite-vec";

import { SqliteEmbeddingQueueRepository } from "../../../../src/modules/retrieval/infrastructure/persistence/sqlite-embedding-queue-repository.ts";
import { EmbeddingVector } from "../../../../src/modules/retrieval/domain/value-objects/embedding-vector.ts";
import type {
  DatabaseConnection,
  PreparedStatement,
  RunResult,
} from "../../../../src/shared/application/ports/database-connection.port.ts";
import { Timestamp } from "../../../../src/shared/domain/value-objects/timestamp.ts";
import { FakeIdGenerator } from "../../../../src/shared/infrastructure/id-generator/fake-id-generator.ts";
import { ANCHOR_TIME_MS, makeWorkspaceId } from "../../../helpers/factories.ts";

class VecDatabase implements DatabaseConnection {
  public readonly loadError: Error | null;
  private readonly db: any;
  private closed = false;

  public constructor() {
    this.db = new (Database as any)(":memory:");
    let err: Error | null = null;
    try {
      this.db.loadExtension(sqliteVec.getLoadablePath());
    } catch (cause: unknown) {
      err = cause instanceof Error ? cause : new Error(String(cause));
    }
    this.loadError = err;
  }

  public prepare(sql: string): PreparedStatement {
    if (this.closed) throw new Error("connection closed");
    const stmt = this.db.prepare(sql);
    return {
      run: (...p: readonly unknown[]): RunResult => {
        const r = stmt.run(...p);
        return { changes: r.changes, lastInsertRowid: r.lastInsertRowid };
      },
      get: (...p: readonly unknown[]): unknown => stmt.get(...p),
      all: (...p: readonly unknown[]): readonly unknown[] =>
        stmt.all(...p) as unknown[],
      iterate: (...p: readonly unknown[]): IterableIterator<unknown> =>
        stmt.iterate(...p) as IterableIterator<unknown>,
    };
  }

  public exec(sql: string): void {
    if (this.closed) throw new Error("connection closed");
    this.db.exec(sql);
  }

  public transaction<T>(fn: () => T): T {
    if (this.closed) throw new Error("connection closed");
    return this.db.transaction(fn)() as T;
  }

  public close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }
}

const SCHEMA = `
  CREATE TABLE embedding_queue (
      id              TEXT    PRIMARY KEY,
      workspace_id    TEXT    NOT NULL,
      target_kind     TEXT    NOT NULL CHECK (target_kind IN ('decision','learning','entity','task','turn')),
      target_row_id   TEXT    NOT NULL,
      enqueued_at_ms  INTEGER NOT NULL,
      attempts        INTEGER NOT NULL DEFAULT 0,
      last_error      TEXT
  );
  CREATE VIRTUAL TABLE embeddings USING vec0(
      id  TEXT PRIMARY KEY,
      vec FLOAT[3]
  );
  CREATE TABLE embedding_metadata (
      id              TEXT    PRIMARY KEY,
      workspace_id    TEXT    NOT NULL,
      target_kind     TEXT    NOT NULL,
      target_row_id   TEXT    NOT NULL,
      embedded_text   TEXT    NOT NULL,
      model_name      TEXT    NOT NULL,
      dimension       INTEGER NOT NULL,
      created_at_ms   INTEGER NOT NULL,
      UNIQUE (target_kind, target_row_id, model_name)
  );
`;

let vecAvailable = false;

beforeAll(() => {
  const probe = new VecDatabase();
  vecAvailable = probe.loadError === null;
  probe.close();
});

let db: VecDatabase;
let idGen: FakeIdGenerator;
let repo: SqliteEmbeddingQueueRepository;

beforeEach(() => {
  db = new VecDatabase();
  if (vecAvailable) {
    db.exec(SCHEMA);
  } else {
    // Without vec0 we can still test the queue half — create only the
    // queue table.
    db.exec(`
      CREATE TABLE embedding_queue (
          id              TEXT    PRIMARY KEY,
          workspace_id    TEXT    NOT NULL,
          target_kind     TEXT    NOT NULL,
          target_row_id   TEXT    NOT NULL,
          enqueued_at_ms  INTEGER NOT NULL,
          attempts        INTEGER NOT NULL DEFAULT 0,
          last_error      TEXT
      );
    `);
  }
  idGen = new FakeIdGenerator();
  repo = new SqliteEmbeddingQueueRepository(db, idGen);
});

afterEach(() => {
  db.close();
});

const ts = (ms: number = ANCHOR_TIME_MS): Timestamp => Timestamp.fromEpochMs(ms);

describe("SqliteEmbeddingQueueRepository - queue", () => {
  it("enqueue persists a row with attempts=0 and lastError=null", async () => {
    await repo.enqueue({
      workspaceId: makeWorkspaceId(),
      targetKind: "decision",
      targetRowId: "row-1",
      enqueuedAt: ts(),
    });

    const items = await repo.dequeueBatch({
      workspaceId: makeWorkspaceId(),
      limit: 10,
      availableAfter: ts(),
    });

    expect(items.length).toBe(1);
    expect(items[0]?.attempts).toBe(0);
    expect(items[0]?.lastError).toBeNull();
    expect(items[0]?.targetKind).toBe("decision");
    expect(items[0]?.targetRowId).toBe("row-1");
  });

  it("dequeueBatch returns oldest-first then by id", async () => {
    await repo.enqueue({
      workspaceId: makeWorkspaceId(),
      targetKind: "decision",
      targetRowId: "row-1",
      enqueuedAt: ts(ANCHOR_TIME_MS),
    });
    await repo.enqueue({
      workspaceId: makeWorkspaceId(),
      targetKind: "learning",
      targetRowId: "row-2",
      enqueuedAt: ts(ANCHOR_TIME_MS - 1000),
    });

    const items = await repo.dequeueBatch({
      workspaceId: makeWorkspaceId(),
      limit: 10,
      availableAfter: ts(ANCHOR_TIME_MS),
    });

    expect(items.length).toBe(2);
    expect(items[0]?.targetRowId).toBe("row-2"); // older first
  });

  it("dequeueBatch respects the limit parameter", async () => {
    for (let i = 0; i < 5; i += 1) {
      await repo.enqueue({
        workspaceId: makeWorkspaceId(),
        targetKind: "decision",
        targetRowId: `r${i}`,
        enqueuedAt: ts(ANCHOR_TIME_MS + i),
      });
    }

    const items = await repo.dequeueBatch({
      workspaceId: makeWorkspaceId(),
      limit: 3,
      availableAfter: ts(),
    });

    expect(items.length).toBe(3);
  });

  it("acknowledge() removes the row from the queue", async () => {
    await repo.enqueue({
      workspaceId: makeWorkspaceId(),
      targetKind: "decision",
      targetRowId: "row-1",
      enqueuedAt: ts(),
    });
    const items = await repo.dequeueBatch({
      workspaceId: makeWorkspaceId(),
      limit: 10,
      availableAfter: ts(),
    });
    const id = items[0]?.id;
    expect(id).toBeDefined();

    await repo.acknowledge(id ?? "");

    const after = await repo.dequeueBatch({
      workspaceId: makeWorkspaceId(),
      limit: 10,
      availableAfter: ts(),
    });
    expect(after.length).toBe(0);
  });

  it("acknowledge() is a no-op for an unknown id", async () => {
    await expect(repo.acknowledge("not-real-id")).resolves.toBeUndefined();
  });

  it("recordFailure() bumps attempts and stores the message", async () => {
    await repo.enqueue({
      workspaceId: makeWorkspaceId(),
      targetKind: "decision",
      targetRowId: "row-1",
      enqueuedAt: ts(),
    });
    const items = await repo.dequeueBatch({
      workspaceId: makeWorkspaceId(),
      limit: 10,
      availableAfter: ts(),
    });
    const id = items[0]?.id ?? "";

    await repo.recordFailure({ queueId: id, errorMessage: "boom" });

    const after = await repo.dequeueBatch({
      workspaceId: makeWorkspaceId(),
      limit: 10,
      availableAfter: ts(ANCHOR_TIME_MS + 1000), // far in the future
    });
    expect(after.length).toBe(1);
    expect(after[0]?.attempts).toBe(1);
    expect(after[0]?.lastError).toBe("boom");
  });

  it("dequeueBatch skips items still in cool-down window", async () => {
    await repo.enqueue({
      workspaceId: makeWorkspaceId(),
      targetKind: "decision",
      targetRowId: "row-1",
      enqueuedAt: ts(ANCHOR_TIME_MS),
    });
    const initial = await repo.dequeueBatch({
      workspaceId: makeWorkspaceId(),
      limit: 10,
      availableAfter: ts(ANCHOR_TIME_MS),
    });
    const id = initial[0]?.id ?? "";
    await repo.recordFailure({ queueId: id, errorMessage: "boom" });

    // availableAfter < enqueued_at_ms → row not eligible
    const blocked = await repo.dequeueBatch({
      workspaceId: makeWorkspaceId(),
      limit: 10,
      availableAfter: ts(ANCHOR_TIME_MS - 1000),
    });
    expect(blocked.length).toBe(0);
  });

  it("dequeueBatch returns failed rows once the cool-down window passes", async () => {
    await repo.enqueue({
      workspaceId: makeWorkspaceId(),
      targetKind: "decision",
      targetRowId: "row-1",
      enqueuedAt: ts(ANCHOR_TIME_MS),
    });
    const initial = await repo.dequeueBatch({
      workspaceId: makeWorkspaceId(),
      limit: 10,
      availableAfter: ts(ANCHOR_TIME_MS),
    });
    const id = initial[0]?.id ?? "";
    await repo.recordFailure({ queueId: id, errorMessage: "boom" });

    const ready = await repo.dequeueBatch({
      workspaceId: makeWorkspaceId(),
      limit: 10,
      availableAfter: ts(ANCHOR_TIME_MS + 5000),
    });
    expect(ready.length).toBe(1);
  });

  it("countPending returns the number of rows for the workspace", async () => {
    expect(await repo.countPending(makeWorkspaceId())).toBe(0);

    await repo.enqueue({
      workspaceId: makeWorkspaceId(),
      targetKind: "decision",
      targetRowId: "r1",
      enqueuedAt: ts(),
    });
    expect(await repo.countPending(makeWorkspaceId())).toBe(1);
  });

  it("dequeueBatch filters by workspace_id", async () => {
    // Insert a row for a different workspace via raw SQL (the repo only
    // takes one WorkspaceId through the typed factory).
    db.prepare(
      "INSERT INTO embedding_queue (id, workspace_id, target_kind, target_row_id, enqueued_at_ms, attempts) VALUES (?, ?, ?, ?, ?, 0)",
    ).run(
      "q-other",
      "01952f3b-7d8c-7000-8000-bbbbbbbbbbbb",
      "decision",
      "rX",
      ANCHOR_TIME_MS,
    );

    const items = await repo.dequeueBatch({
      workspaceId: makeWorkspaceId(),
      limit: 10,
      availableAfter: ts(),
    });
    expect(items.length).toBe(0);
  });

  it("returns frozen empty arrays from dequeueBatch when nothing matches", async () => {
    const items = await repo.dequeueBatch({
      workspaceId: makeWorkspaceId(),
      limit: 10,
      availableAfter: ts(),
    });
    expect(Object.isFrozen(items)).toBe(true);
    expect(items.length).toBe(0);
  });

  // ─── B-MCP-7: resetPermanentFailures (recall reset-queue) ─────────────

  describe("resetPermanentFailures (B-MCP-7)", () => {
    it("clears attempts and last_error on rows at or above the threshold", async () => {
      const ws = makeWorkspaceId();
      // Seed: 2 perma-failed rows + 1 partially-failed row (attempts=3) +
      // 1 untouched row.
      db.prepare(
        "INSERT INTO embedding_queue (id, workspace_id, target_kind, target_row_id, enqueued_at_ms, attempts, last_error) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run("q-perm-1", ws.toString(), "decision", "r1", ANCHOR_TIME_MS, 5, "fastembed init failed");
      db.prepare(
        "INSERT INTO embedding_queue (id, workspace_id, target_kind, target_row_id, enqueued_at_ms, attempts, last_error) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run("q-perm-2", ws.toString(), "learning", "r2", ANCHOR_TIME_MS, 6, "model not loaded");
      db.prepare(
        "INSERT INTO embedding_queue (id, workspace_id, target_kind, target_row_id, enqueued_at_ms, attempts, last_error) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run("q-mid", ws.toString(), "decision", "r3", ANCHOR_TIME_MS, 3, "transient");
      db.prepare(
        "INSERT INTO embedding_queue (id, workspace_id, target_kind, target_row_id, enqueued_at_ms, attempts, last_error) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run("q-fresh", ws.toString(), "entity", "r4", ANCHOR_TIME_MS, 0, null);

      const updated = await repo.resetPermanentFailures({
        workspaceId: ws,
        attemptsAtLeast: 5,
      });
      expect(updated).toBe(2);

      const rowsById = (id: string): { attempts: number; last_error: string | null } =>
        db
          .prepare("SELECT attempts, last_error FROM embedding_queue WHERE id = ?")
          .get(id) as { attempts: number; last_error: string | null };

      expect(rowsById("q-perm-1").attempts).toBe(0);
      expect(rowsById("q-perm-1").last_error).toBeNull();
      expect(rowsById("q-perm-2").attempts).toBe(0);
      expect(rowsById("q-perm-2").last_error).toBeNull();
      // Mid-attempt row untouched.
      expect(rowsById("q-mid").attempts).toBe(3);
      expect(rowsById("q-mid").last_error).toBe("transient");
      // Fresh row untouched.
      expect(rowsById("q-fresh").attempts).toBe(0);
    });

    it("returns 0 when no rows meet the threshold", async () => {
      const ws = makeWorkspaceId();
      db.prepare(
        "INSERT INTO embedding_queue (id, workspace_id, target_kind, target_row_id, enqueued_at_ms, attempts, last_error) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run("q-fresh", ws.toString(), "decision", "r1", ANCHOR_TIME_MS, 1, null);

      const updated = await repo.resetPermanentFailures({
        workspaceId: ws,
        attemptsAtLeast: 5,
      });
      expect(updated).toBe(0);
    });

    it("scopes the reset to the requested workspaceId", async () => {
      const wsA = makeWorkspaceId();
      const wsB = "01952f3b-7d8c-7000-8000-bbbbbbbbbbbb";

      db.prepare(
        "INSERT INTO embedding_queue (id, workspace_id, target_kind, target_row_id, enqueued_at_ms, attempts, last_error) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run("q-a", wsA.toString(), "decision", "rA", ANCHOR_TIME_MS, 5, "boom");
      db.prepare(
        "INSERT INTO embedding_queue (id, workspace_id, target_kind, target_row_id, enqueued_at_ms, attempts, last_error) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run("q-b", wsB, "decision", "rB", ANCHOR_TIME_MS, 5, "boom");

      const updated = await repo.resetPermanentFailures({
        workspaceId: wsA,
        attemptsAtLeast: 5,
      });
      expect(updated).toBe(1);

      // wsB row UNTOUCHED — defence in depth on top of schema-level scope.
      const otherRow = db
        .prepare("SELECT attempts, last_error FROM embedding_queue WHERE id = ?")
        .get("q-b") as { attempts: number; last_error: string | null };
      expect(otherRow.attempts).toBe(5);
      expect(otherRow.last_error).toBe("boom");
    });
  });
});

describe("SqliteEmbeddingQueueRepository - persistEmbedding", () => {
  it("persists vector + metadata atomically", async () => {
    if (!vecAvailable) return; // requires vec0
    const v = EmbeddingVector.create(new Float32Array([0.1, 0.2, 0.3]));
    await repo.persistEmbedding({
      workspaceId: makeWorkspaceId(),
      targetKind: "decision",
      targetRowId: "row-1",
      embeddedText: "hello world",
      modelName: "test/model",
      vector: v,
      persistedAt: ts(),
    });

    const meta = db
      .prepare(
        "SELECT target_kind, target_row_id, model_name, embedded_text, dimension FROM embedding_metadata WHERE target_row_id = ?",
      )
      .get("row-1") as
      | {
          target_kind: string;
          target_row_id: string;
          model_name: string;
          embedded_text: string;
          dimension: number;
        }
      | undefined;
    expect(meta).toBeDefined();
    expect(meta?.target_kind).toBe("decision");
    expect(meta?.model_name).toBe("test/model");
    expect(meta?.embedded_text).toBe("hello world");
    expect(meta?.dimension).toBe(3);
  });

  it("UPSERT replaces the metadata row on the natural key (kind, row_id, model)", async () => {
    if (!vecAvailable) return;
    const v1 = EmbeddingVector.create(new Float32Array([0.1, 0.2, 0.3]));
    const v2 = EmbeddingVector.create(new Float32Array([0.9, 0.8, 0.7]));
    await repo.persistEmbedding({
      workspaceId: makeWorkspaceId(),
      targetKind: "decision",
      targetRowId: "row-1",
      embeddedText: "old",
      modelName: "m",
      vector: v1,
      persistedAt: ts(),
    });
    await repo.persistEmbedding({
      workspaceId: makeWorkspaceId(),
      targetKind: "decision",
      targetRowId: "row-1",
      embeddedText: "new",
      modelName: "m",
      vector: v2,
      persistedAt: ts(ANCHOR_TIME_MS + 1000),
    });

    const rows = db
      .prepare(
        "SELECT COUNT(*) AS n, MAX(embedded_text) AS t FROM embedding_metadata WHERE target_row_id = ?",
      )
      .get("row-1") as { n: number; t: string };
    expect(rows.n).toBe(1);
    expect(rows.t).toBe("new");
  });
});
