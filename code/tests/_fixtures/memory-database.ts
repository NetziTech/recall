/**
 * Helpers for memory-module infrastructure tests.
 *
 * The memory adapters need a SQLite connection with the core memory
 * schema applied. The retrieval-owned migration (002) depends on the
 * `sqlite-vec` extension which is unavailable in many test environments,
 * so this helper applies ONLY the migrations the memory adapters need:
 *
 *   - 000__bootstrap.sql           (`_meta` table — the bookkeeping
 *                                   row the migrations runner expects)
 *   - 004__core-memory-schema.sql  (sessions, turns, decisions,
 *                                   learnings, entities, relations,
 *                                   tasks + their FTS5 shadows)
 *   - 005__perf-indexes.sql        (post-release perf indexes)
 *   - 008__decisions-content.sql   (B-MCP-4: adds `decisions.content`
 *                                   + rebuilds the FTS5 index over it)
 *
 * The `embedding_queue` table from migration 002 is created in a
 * minimal stub form so the `SqliteEmbeddingEnqueuer` adapter can
 * exercise its prepared statement against a real schema. The full vec0
 * setup is intentionally NOT applied — the enqueuer adapter only
 * writes to `embedding_queue`, not the vector store itself.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import Database from "better-sqlite3-multiple-ciphers";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type {
  DatabaseConnection,
  PreparedStatement,
  RunResult,
} from "../../src/shared/application/ports/database-connection.port.ts";

class TestDatabase implements DatabaseConnection {
  private readonly db: any;
  private closed = false;

  public constructor() {
    this.db = new (Database as any)(":memory:");
  }

  public prepare(sql: string): PreparedStatement {
    if (this.closed) throw new Error("connection closed");
    const stmt = this.db.prepare(sql);
    return {
      run: (...params: readonly unknown[]): RunResult => {
        const result = stmt.run(...params);
        return {
          changes: result.changes,
          lastInsertRowid: result.lastInsertRowid,
        };
      },
      get: (...params: readonly unknown[]): unknown => stmt.get(...params),
      all: (...params: readonly unknown[]): readonly unknown[] => {
        return stmt.all(...params) as unknown[];
      },
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
    const tx = this.db.transaction(fn);
    return tx() as T;
  }

  public close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }
}

const MIGRATIONS_DIR = path.resolve(
  fileURLToPath(new URL("../../migrations", import.meta.url)),
);

const REQUIRED_MIGRATIONS: readonly string[] = Object.freeze([
  "000__bootstrap.sql",
  "004__core-memory-schema.sql",
  "005__perf-indexes.sql",
  "008__decisions-content.sql",
]);

/**
 * Minimal `embedding_queue` table for the enqueuer test. Mirrors the
 * shape from `code/migrations/002__retrieval-schema.sql` minus the
 * vec0 dependency.
 */
const EMBEDDING_QUEUE_SQL = `
CREATE TABLE IF NOT EXISTS embedding_queue (
    id              TEXT    PRIMARY KEY,
    workspace_id    TEXT    NOT NULL,
    target_kind     TEXT    NOT NULL CHECK (target_kind IN ('decision', 'learning', 'entity', 'task', 'turn')),
    target_row_id   TEXT    NOT NULL,
    enqueued_at_ms  INTEGER NOT NULL,
    attempts        INTEGER NOT NULL DEFAULT 0,
    last_error      TEXT
);
CREATE TABLE IF NOT EXISTS embedding_metadata (
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
CREATE TABLE IF NOT EXISTS embeddings (
    id  TEXT PRIMARY KEY
);
`;

/**
 * Builds an in-memory `DatabaseConnection` with the memory module's
 * schema applied. Returns the open connection — caller must
 * `db.close()` when done.
 */
export async function newMemoryDatabase(): Promise<TestDatabase> {
  const db = new TestDatabase();
  for (const filename of REQUIRED_MIGRATIONS) {
    const sql = await fs.readFile(path.join(MIGRATIONS_DIR, filename), "utf8");
    db.exec(sql);
  }
  // Stub embedding tables so the enqueuer adapter and the wiper can
  // operate against a real DB.
  db.exec(EMBEDDING_QUEUE_SQL);
  return db;
}
