/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3-multiple-ciphers";
import * as sqliteVec from "sqlite-vec";

import { SqliteVecVectorSearch } from "../../../../src/modules/retrieval/infrastructure/persistence/sqlite-vec-vector-search.ts";
import { EmbeddingVector } from "../../../../src/modules/retrieval/domain/value-objects/embedding-vector.ts";
import { QueryKind } from "../../../../src/modules/retrieval/domain/value-objects/query-kind.ts";
import { RecallFilters } from "../../../../src/modules/retrieval/domain/value-objects/recall-filters.ts";
import { Tags } from "../../../../src/shared/domain/value-objects/tags.ts";
import type {
  DatabaseConnection,
  PreparedStatement,
  RunResult,
} from "../../../../src/shared/application/ports/database-connection.port.ts";
import { FIXED_WORKSPACE_UUID, makeWorkspaceId } from "../../../helpers/factories.ts";

/**
 * SQLite connection adapter that loads the `sqlite-vec` extension on
 * construction. The standard `InMemoryDatabase` test double does not
 * load extensions, so the vector-search adapter needs this thin
 * wrapper for the integration paths.
 *
 * Graceful degradation: if the extension fails to load (e.g. the host
 * lacks the binary), the constructor stores the error so the test
 * can decide whether to skip itself instead of erroring.
 */
class VecEnabledDatabase implements DatabaseConnection {
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
      run: (...params: readonly unknown[]): RunResult => {
        const r = stmt.run(...params);
        return { changes: r.changes, lastInsertRowid: r.lastInsertRowid };
      },
      get: (...params: readonly unknown[]): unknown => stmt.get(...params),
      all: (...params: readonly unknown[]): readonly unknown[] =>
        stmt.all(...params) as unknown[],
      iterate: (...params: readonly unknown[]): IterableIterator<unknown> =>
        stmt.iterate(...params) as IterableIterator<unknown>,
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

const SCHEMA_VEC = `
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

const filters = (
  over: Partial<{ kinds: QueryKind[]; limit: number }> = {},
): RecallFilters =>
  RecallFilters.create({
    kinds: over.kinds ?? [],
    tags: Tags.empty(),
    mustHaveTags: Tags.empty(),
    mustNotHaveTags: Tags.empty(),
    minConfidence: null,
    since: null,
    until: null,
    limit: over.limit ?? 10,
  });

const float32ToBlob = (arr: number[]): Buffer => {
  const f = new Float32Array(arr);
  return Buffer.from(f.buffer, f.byteOffset, f.byteLength);
};

const seed = (db: VecEnabledDatabase): void => {
  db.exec(SCHEMA_VEC);
  const insertVec = db.prepare("INSERT INTO embeddings (id, vec) VALUES (?, ?)");
  const insertMeta = db.prepare(
    `INSERT INTO embedding_metadata (id, workspace_id, target_kind, target_row_id, embedded_text, model_name, dimension, created_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const wsId = FIXED_WORKSPACE_UUID;

  // Three points: two close to query (1,0,0), one far away.
  // Use distinct kinds so kind filter tests can discriminate.
  const seedRows: { id: string; kind: string; row: string; v: number[] }[] = [
    { id: "e1", kind: "decision", row: "dec-1", v: [1, 0, 0] }, // distance 0
    { id: "e2", kind: "learning", row: "learn-1", v: [0.9, 0.1, 0] }, // close
    { id: "e3", kind: "entity", row: "ent-1", v: [-1, 0, 0] }, // far
  ];

  for (const r of seedRows) {
    insertVec.run(r.id, float32ToBlob(r.v));
    insertMeta.run(r.id, wsId, r.kind, r.row, "text", "test-model", 3, 1700000000000);
  }
};

let vecDb: VecEnabledDatabase;
let vecAvailable = false;

beforeAll(() => {
  // One-shot probe: if the extension cannot be loaded on this host, mark
  // the suite as unavailable so the path-of-error tests still run while
  // the integration tests skip with an explicit reason.
  const probe = new VecEnabledDatabase();
  vecAvailable = probe.loadError === null;
  if (!vecAvailable) {
    console.warn(
      "[vec-test] sqlite-vec unavailable — degraded tests only. err:",
      probe.loadError?.message,
    );
  }
  probe.close();
});

beforeEach(() => {
  vecDb = new VecEnabledDatabase();
});

afterEach(() => {
  vecDb.close();
});

/**
 * Helper: skip the body if vec0 is unavailable on this host.
 * vec0 ships pre-built binaries; if the test environment lacks the
 * platform variant, we degrade rather than failing the suite.
 */
const requireVec = (): boolean => {
  if (!vecAvailable) {
    console.warn("vec0 unavailable on host — skipping integration assertion");
    return false;
  }
  return true;
};

describe("SqliteVecVectorSearch (integration)", () => {
  it(
    "returns hits sorted by cosine distance ascending",
    async () => {
      if (!requireVec()) return;
      seed(vecDb);
      const adapter = new SqliteVecVectorSearch(vecDb);
      const query = EmbeddingVector.create(new Float32Array([1, 0, 0]));

      const out = await adapter.search(query, makeWorkspaceId(), filters({ limit: 5 }));

      expect(out.length).toBeGreaterThan(0);
      // The closest (distance 0) must come first.
      expect(out[0]?.id).toBe("dec-1");
    },
  );

  it(
    "filters by workspace id (excludes other workspaces)",
    async () => {
      if (!requireVec()) return;
      seed(vecDb);
      // Insert one row pinned to a different workspace.
      const insertVec = vecDb.prepare(
        "INSERT INTO embeddings (id, vec) VALUES (?, ?)",
      );
      const insertMeta = vecDb.prepare(
        `INSERT INTO embedding_metadata (id, workspace_id, target_kind, target_row_id, embedded_text, model_name, dimension, created_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      insertVec.run("eX", float32ToBlob([1, 0, 0]));
      insertMeta.run(
        "eX",
        "01952f3b-7d8c-7000-8000-bbbbbbbbbbbb", // different workspace
        "decision",
        "dec-other",
        "x",
        "test-model",
        3,
        1700000000000,
      );

      const adapter = new SqliteVecVectorSearch(vecDb);
      const out = await adapter.search(
        EmbeddingVector.create(new Float32Array([1, 0, 0])),
        makeWorkspaceId(),
        filters({ limit: 10 }),
      );

      const ids = out.map((h) => h.id);
      expect(ids).not.toContain("dec-other");
    },
  );

  it(
    "applies the kind filter on the client side",
    async () => {
      if (!requireVec()) return;
      seed(vecDb);
      const adapter = new SqliteVecVectorSearch(vecDb);
      const out = await adapter.search(
        EmbeddingVector.create(new Float32Array([1, 0, 0])),
        makeWorkspaceId(),
        filters({ kinds: [QueryKind.decision()], limit: 10 }),
      );

      for (const hit of out) expect(hit.kind).toBe("decision");
    },
  );

  it(
    "respects the limit (slice after kind filter)",
    async () => {
      if (!requireVec()) return;
      seed(vecDb);
      const adapter = new SqliteVecVectorSearch(vecDb);
      const out = await adapter.search(
        EmbeddingVector.create(new Float32Array([1, 0, 0])),
        makeWorkspaceId(),
        filters({ limit: 1 }),
      );
      expect(out.length).toBeLessThanOrEqual(1);
    },
  );

  it(
    "returns a frozen array",
    async () => {
      if (!requireVec()) return;
      seed(vecDb);
      const adapter = new SqliteVecVectorSearch(vecDb);
      const out = await adapter.search(
        EmbeddingVector.create(new Float32Array([1, 0, 0])),
        makeWorkspaceId(),
        filters(),
      );
      expect(Object.isFrozen(out)).toBe(true);
    },
  );

  it(
    "returns CosineScore values in [0, 1]",
    async () => {
      if (!requireVec()) return;
      seed(vecDb);
      const adapter = new SqliteVecVectorSearch(vecDb);
      const out = await adapter.search(
        EmbeddingVector.create(new Float32Array([1, 0, 0])),
        makeWorkspaceId(),
        filters(),
      );
      for (const hit of out) {
        const n = hit.score.toNumber();
        expect(n).toBeGreaterThanOrEqual(0);
        expect(n).toBeLessThanOrEqual(1);
      }
    },
  );

  it(
    "returns an empty array when no rows match the workspace",
    async () => {
      if (!requireVec()) return;
      vecDb.exec(SCHEMA_VEC); // schema only, no rows
      const adapter = new SqliteVecVectorSearch(vecDb);
      const out = await adapter.search(
        EmbeddingVector.create(new Float32Array([1, 0, 0])),
        makeWorkspaceId(),
        filters(),
      );
      expect(out).toEqual([]);
    },
  );

  it("throws an explicit error when the embeddings table does not exist (degraded path)", () => {
    // Simulate vec0 not loaded by NOT creating the embeddings table.
    // The adapter must surface the SQL error so the use case can
    // catch and degrade to FTS5-only.
    //
    // Note: the adapter's synchronous `db.prepare` throws BEFORE the
    // method returns its Promise — we therefore wrap the whole call
    // in a sync `expect(...).toThrow` rather than an async-rejection
    // assertion (which would never see the error).
    const adapter = new SqliteVecVectorSearch(vecDb);
    expect(() =>
      adapter.search(
        EmbeddingVector.create(new Float32Array([1, 0, 0])),
        makeWorkspaceId(),
        filters(),
      ),
    ).toThrow();
  });
});
