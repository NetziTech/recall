/* eslint-disable @typescript-eslint/no-explicit-any */
import Database from "better-sqlite3-multiple-ciphers";
import type {
  DatabaseConnection,
  PreparedStatement,
  RunResult,
} from "../../src/shared/application/ports/database-connection.port.ts";

/**
 * Adapter wrapping an in-memory `better-sqlite3` database for unit
 * tests. Implements `DatabaseConnection` so adapters can be exercised
 * against real SQL without needing a temp file.
 */
export class InMemoryDatabase implements DatabaseConnection {
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
        const rows = stmt.all(...params) as unknown[];
        return rows;
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
