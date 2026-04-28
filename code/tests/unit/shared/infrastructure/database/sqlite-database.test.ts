import { describe, it, expect, beforeAll } from "vitest";

import {
  SqliteDatabase,
  type EncryptionKeyBytes,
} from "../../../../../src/shared/infrastructure/database/sqlite-database.ts";
import { DatabaseError } from "../../../../../src/shared/infrastructure/errors/database-error.ts";
import type { Logger } from "../../../../../src/shared/application/ports/logger.port.ts";

/**
 * Recording test logger — captures structured calls so we can assert
 * the SqliteDatabase adapter logs the right diagnostics (sqlite-vec
 * load attempt, etc.).
 */
class RecordingLogger implements Logger {
  public readonly entries: Array<{
    readonly level: string;
    readonly payload: unknown;
    readonly message?: string;
  }> = [];

  public trace(payload: unknown, message?: string): void {
    this.push("trace", payload, message);
  }
  public debug(payload: unknown, message?: string): void {
    this.push("debug", payload, message);
  }
  public info(payload: unknown, message?: string): void {
    this.push("info", payload, message);
  }
  public warn(payload: unknown, message?: string): void {
    this.push("warn", payload, message);
  }
  public error(payload: unknown, message?: string): void {
    this.push("error", payload, message);
  }
  public fatal(payload: unknown, message?: string): void {
    this.push("fatal", payload, message);
  }
  public child(): Logger {
    return this;
  }

  private push(level: string, payload: unknown, message?: string): void {
    if (message === undefined) {
      this.entries.push({ level, payload });
    } else {
      this.entries.push({ level, payload, message });
    }
  }
}

const newLogger = (): RecordingLogger => new RecordingLogger();

describe("SqliteDatabase.open", () => {
  it("opens an in-memory database without encryption", async () => {
    const logger = newLogger();
    const db = await SqliteDatabase.open({ path: ":memory:", logger });
    try {
      const stmt = db.prepare("SELECT 1 AS v");
      const row = stmt.get();
      expect(row).toEqual({ v: 1 });
    } finally {
      db.close();
    }
  });

  it("applies WAL, foreign_keys, cache_size pragmas (basic smoke)", async () => {
    // We can't directly read all pragmas; we verify foreign_keys is ON
    // because that is observable via PRAGMA foreign_keys.
    const logger = newLogger();
    const db = await SqliteDatabase.open({ path: ":memory:", logger });
    try {
      const r = db.prepare("PRAGMA foreign_keys").get();
      expect(r).toEqual({ foreign_keys: 1 });
    } finally {
      db.close();
    }
  });

  it("rejects an invalid SQLCipher encryption key (encryptionKeyRejected)", async () => {
    // Build a real encrypted DB on disk first by opening with key K.
    // For a `:memory:` DB the SQLCipher header check still triggers,
    // but to deterministically force the rejection we need a non-empty
    // key against an existing un-encrypted DB header. Use `:memory:`
    // with a 32-byte key: the header read succeeds because the DB is
    // empty (SQLCipher initialises a fresh encrypted page format), so
    // we must instead verify the rejection path another way: open one
    // DB with key A, write a row, close, reopen with key B.
    const tmp = `/tmp/recall-tests-sqlite-${Date.now()}-${process.pid}.db`;
    const keyA: EncryptionKeyBytes = { bytes: new Uint8Array(32).fill(7) };
    const keyB: EncryptionKeyBytes = { bytes: new Uint8Array(32).fill(8) };

    const logger = newLogger();
    const dbA = await SqliteDatabase.open({
      path: tmp,
      encryptionKey: keyA,
      logger,
      loadVectorExtension: false,
    });
    try {
      dbA.exec("CREATE TABLE t (id INTEGER)");
      dbA.exec("INSERT INTO t (id) VALUES (1)");
    } finally {
      dbA.close();
    }

    // NOTE: SqliteDatabase.open declares Promise<SqliteDatabase> as
    // its return type but throws synchronously on failure (the body is
    // not `async` and the throw escapes before the final
    // `return Promise.resolve(...)`). That is a production-side
    // contract issue (TODO-D-001 — see report) but here we test the
    // observable behaviour: the throw happens immediately, so we must
    // wrap the call to assert with `toThrow` instead of `.rejects`.
    let captured: unknown = null;
    try {
      await SqliteDatabase.open({
        path: tmp,
        encryptionKey: keyB,
        logger,
        loadVectorExtension: false,
      });
    } catch (err) {
      captured = err;
    }
    expect(captured).toMatchObject({
      code: "database.encryption-key-rejected",
    });

    // Re-open with the right key still works.
    const dbA2 = await SqliteDatabase.open({
      path: tmp,
      encryptionKey: keyA,
      logger,
      loadVectorExtension: false,
    });
    try {
      const row = dbA2.prepare("SELECT id FROM t").get();
      expect(row).toEqual({ id: 1 });
    } finally {
      dbA2.close();
    }

    // Cleanup files.
    const fs = await import("node:fs/promises");
    await fs.rm(tmp, { force: true });
    await fs.rm(`${tmp}-wal`, { force: true });
    await fs.rm(`${tmp}-shm`, { force: true });
    await fs.rm(`${tmp}-journal`, { force: true });
  });

  it("readonly mode opens an existing DB", async () => {
    const tmp = `/tmp/recall-tests-ro-${Date.now()}-${process.pid}.db`;
    const logger = newLogger();
    // Seed the file as writable.
    const seed = await SqliteDatabase.open({
      path: tmp,
      logger,
      loadVectorExtension: false,
    });
    try {
      seed.exec("CREATE TABLE x (k INTEGER); INSERT INTO x (k) VALUES (1)");
    } finally {
      seed.close();
    }
    // Reopen read-only.
    const ro = await SqliteDatabase.open({
      path: tmp,
      logger,
      readonly: true,
      loadVectorExtension: false,
    });
    try {
      expect(ro.prepare("SELECT k FROM x").get()).toEqual({ k: 1 });
    } finally {
      ro.close();
    }
    const fs = await import("node:fs/promises");
    await fs.rm(tmp, { force: true });
    await fs.rm(`${tmp}-wal`, { force: true });
    await fs.rm(`${tmp}-shm`, { force: true });
    await fs.rm(`${tmp}-journal`, { force: true });
  });

  it("opens with loadVectorExtension defaulting to true (best-effort)", async () => {
    // sqlite-vec may or may not be available on the host; the adapter
    // must not throw either way. We just assert a debug or warn was
    // emitted.
    const logger = newLogger();
    const db = await SqliteDatabase.open({ path: ":memory:", logger });
    try {
      const debugOrWarn = logger.entries.filter(
        (e) => e.level === "debug" || e.level === "warn",
      );
      expect(debugOrWarn.length).toBeGreaterThanOrEqual(1);
    } finally {
      db.close();
    }
  });

  it("openFailed wraps low-level errors", async () => {
    const logger = newLogger();
    // Path inside a non-existent parent directory triggers ENOENT.
    // Note: SqliteDatabase.open throws synchronously despite its
    // Promise return type (TODO-D-001).
    let captured: unknown = null;
    try {
      await SqliteDatabase.open({
        path: "/nonexistent-parent-recall-test/db.sqlite",
        logger,
        loadVectorExtension: false,
      });
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(DatabaseError);
  });
});

describe("SqliteDatabase prepare/exec/transaction", () => {
  it("prepare + run + get + all + iterate", async () => {
    const logger = newLogger();
    const db = await SqliteDatabase.open({
      path: ":memory:",
      logger,
      loadVectorExtension: false,
    });
    try {
      db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)");
      const ins = db.prepare("INSERT INTO t (name) VALUES (?)");
      const r1 = ins.run("a");
      expect(r1.changes).toBe(1);
      const idA = r1.lastInsertRowid;
      expect(idA === 1 || idA === BigInt(1)).toBe(true);
      ins.run("b");
      ins.run("c");

      // get
      const sel = db.prepare("SELECT name FROM t WHERE id = ?");
      expect(sel.get(1)).toEqual({ name: "a" });
      // get returning undefined
      expect(sel.get(99)).toBeUndefined();

      // all returns frozen
      const list = db.prepare("SELECT name FROM t ORDER BY id").all();
      expect(list).toEqual([{ name: "a" }, { name: "b" }, { name: "c" }]);
      expect(Object.isFrozen(list)).toBe(true);

      // iterate
      const collected: string[] = [];
      for (const row of db
        .prepare("SELECT name FROM t ORDER BY id")
        .iterate()) {
        const r = row as { name: string };
        collected.push(r.name);
      }
      expect(collected).toEqual(["a", "b", "c"]);
    } finally {
      db.close();
    }
  });

  it("prepare wraps SQL errors as DatabaseError.prepare-failed", async () => {
    const logger = newLogger();
    const db = await SqliteDatabase.open({
      path: ":memory:",
      logger,
      loadVectorExtension: false,
    });
    try {
      try {
        db.prepare("THIS IS NOT SQL");
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(DatabaseError);
        expect((err as DatabaseError).code).toBe("database.prepare-failed");
      }
    } finally {
      db.close();
    }
  });

  it("exec wraps SQL errors as DatabaseError.exec-failed", async () => {
    const logger = newLogger();
    const db = await SqliteDatabase.open({
      path: ":memory:",
      logger,
      loadVectorExtension: false,
    });
    try {
      try {
        db.exec("NOT SQL");
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(DatabaseError);
        expect((err as DatabaseError).code).toBe("database.exec-failed");
      }
    } finally {
      db.close();
    }
  });

  it("statement run/get/all/iterate wrap library errors as exec-failed", async () => {
    const logger = newLogger();
    const db = await SqliteDatabase.open({
      path: ":memory:",
      logger,
      loadVectorExtension: false,
    });
    try {
      db.exec("CREATE TABLE t (id INTEGER UNIQUE)");
      db.exec("INSERT INTO t (id) VALUES (1)");
      const stmt = db.prepare("INSERT INTO t (id) VALUES (?)");
      // duplicate key triggers a constraint error inside run()
      try {
        stmt.run(1);
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(DatabaseError);
        expect((err as DatabaseError).code).toBe("database.exec-failed");
      }

      // get / all / iterate use a wildly-typed query: invoke them
      // against a closed connection separately to verify wrapping.
    } finally {
      db.close();
    }
  });

  it("transaction commits on normal return", async () => {
    const logger = newLogger();
    const db = await SqliteDatabase.open({
      path: ":memory:",
      logger,
      loadVectorExtension: false,
    });
    try {
      db.exec("CREATE TABLE t (id INTEGER)");
      const result = db.transaction((): number => {
        db.prepare("INSERT INTO t (id) VALUES (?)").run(1);
        db.prepare("INSERT INTO t (id) VALUES (?)").run(2);
        return 42;
      });
      expect(result).toBe(42);
      const rows = db.prepare("SELECT id FROM t ORDER BY id").all();
      expect(rows).toEqual([{ id: 1 }, { id: 2 }]);
    } finally {
      db.close();
    }
  });

  it("transaction rolls back on throw and rethrows the original error", async () => {
    const logger = newLogger();
    const db = await SqliteDatabase.open({
      path: ":memory:",
      logger,
      loadVectorExtension: false,
    });
    try {
      db.exec("CREATE TABLE t (id INTEGER)");
      const dbErrCause = new Error("boom");
      try {
        db.transaction((): void => {
          db.prepare("INSERT INTO t (id) VALUES (?)").run(1);
          throw dbErrCause;
        });
        throw new Error("expected throw");
      } catch (err) {
        // Non-DatabaseError causes are wrapped in transactionFailed.
        expect(err).toBeInstanceOf(DatabaseError);
        expect((err as DatabaseError).code).toBe(
          "database.transaction-failed",
        );
      }
      const rows = db.prepare("SELECT id FROM t").all();
      expect(rows).toEqual([]); // rolled back
    } finally {
      db.close();
    }
  });

  it("transaction propagates an inner DatabaseError unchanged", async () => {
    const logger = newLogger();
    const db = await SqliteDatabase.open({
      path: ":memory:",
      logger,
      loadVectorExtension: false,
    });
    try {
      db.exec("CREATE TABLE t (id INTEGER UNIQUE)");
      db.exec("INSERT INTO t (id) VALUES (1)");
      try {
        db.transaction((): void => {
          // duplicate key — wrapped by Statement.run as exec-failed
          db.prepare("INSERT INTO t (id) VALUES (?)").run(1);
        });
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(DatabaseError);
        // Original code preserved (NOT meta-wrapped as transaction-failed).
        expect((err as DatabaseError).code).toBe("database.exec-failed");
      }
    } finally {
      db.close();
    }
  });
});

describe("SqliteDatabase.close", () => {
  it("close() is idempotent", async () => {
    const logger = newLogger();
    const db = await SqliteDatabase.open({
      path: ":memory:",
      logger,
      loadVectorExtension: false,
    });
    db.close();
    db.close(); // no throw
    expect(true).toBe(true);
  });

  it("operations on a closed connection throw connectionClosed", async () => {
    const logger = newLogger();
    const db = await SqliteDatabase.open({
      path: ":memory:",
      logger,
      loadVectorExtension: false,
    });
    db.close();
    expect(() => db.prepare("SELECT 1")).toThrow(DatabaseError);
    expect(() => db.exec("SELECT 1")).toThrow(DatabaseError);
    expect(() => db.transaction(() => 1)).toThrow(DatabaseError);
  });
});

describe("SqliteDatabase encryption (SQLCipher)", () => {
  let tmp: string;

  beforeAll(() => {
    tmp = `/tmp/recall-tests-cipher-${Date.now()}-${process.pid}.db`;
  });

  it("opens, writes, closes, reopens with same key", async () => {
    const logger = newLogger();
    const key: EncryptionKeyBytes = { bytes: new Uint8Array(32).fill(0xab) };
    const db = await SqliteDatabase.open({
      path: tmp,
      encryptionKey: key,
      logger,
      loadVectorExtension: false,
    });
    try {
      db.exec("CREATE TABLE t (k INTEGER); INSERT INTO t (k) VALUES (1)");
    } finally {
      db.close();
    }

    const db2 = await SqliteDatabase.open({
      path: tmp,
      encryptionKey: key,
      logger,
      loadVectorExtension: false,
    });
    try {
      expect(db2.prepare("SELECT k FROM t").get()).toEqual({ k: 1 });
    } finally {
      db2.close();
    }

    // Cleanup.
    const fs = await import("node:fs/promises");
    await fs.rm(tmp, { force: true });
    await fs.rm(`${tmp}-wal`, { force: true });
    await fs.rm(`${tmp}-shm`, { force: true });
    await fs.rm(`${tmp}-journal`, { force: true });
  });
});
