/**
 * Edge-case coverage for SqliteDatabase paths the existing test file
 * does not exercise: Statement.get/all/iterate catch blocks,
 * SqliteStatement.source(), and the SQLCipher hex-padding branch
 * (byte values < 16 require leading zero).
 */
import { describe, expect, it } from "vitest";

import {
  SqliteDatabase,
  type EncryptionKeyBytes,
} from "../../../../../src/shared/infrastructure/database/sqlite-database.ts";
import { DatabaseError } from "../../../../../src/shared/infrastructure/errors/database-error.ts";
import type { Logger } from "../../../../../src/shared/application/ports/logger.port.ts";

class SilentLogger implements Logger {
  public debug(): void { /* no-op */ }
  public trace(): void { /* no-op */ }
  public info(): void { /* no-op */ }
  public warn(): void { /* no-op */ }
  public error(): void { /* no-op */ }
  public fatal(): void { /* no-op */ }
  public child(): Logger { return this; }
}

describe("SqliteStatement.get/all/iterate wrap library errors", () => {
  it("get() wraps an internal error as exec-failed", async () => {
    const db = await SqliteDatabase.open({
      path: ":memory:",
      logger: new SilentLogger(),
      loadVectorExtension: false,
    });
    try {
      db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");
      // Bind a wrong parameter type to a typed column. better-sqlite3
      // raises on `get()` not on `prepare`.
      const stmt = db.prepare("SELECT id FROM t WHERE id = ?");
      // Pass a Symbol — better-sqlite3 rejects this as an invalid bind.
      const symParam = Symbol("nope");
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        stmt.get(symParam as any);
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(DatabaseError);
        expect((err as DatabaseError).code).toBe("database.exec-failed");
      }
    } finally {
      db.close();
    }
  });

  it("all() wraps an internal error as exec-failed", async () => {
    const db = await SqliteDatabase.open({
      path: ":memory:",
      logger: new SilentLogger(),
      loadVectorExtension: false,
    });
    try {
      db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");
      const stmt = db.prepare("SELECT id FROM t WHERE id = ?");
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        stmt.all(Symbol("nope") as any);
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(DatabaseError);
        expect((err as DatabaseError).code).toBe("database.exec-failed");
      }
    } finally {
      db.close();
    }
  });

  it("iterate() wraps an internal error as exec-failed", async () => {
    const db = await SqliteDatabase.open({
      path: ":memory:",
      logger: new SilentLogger(),
      loadVectorExtension: false,
    });
    try {
      db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");
      const stmt = db.prepare("SELECT id FROM t WHERE id = ?");
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        stmt.iterate(Symbol("nope") as any);
        throw new Error("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(DatabaseError);
        expect((err as DatabaseError).code).toBe("database.exec-failed");
      }
    } finally {
      db.close();
    }
  });
});

describe("SqliteDatabase.bytesToHex covers padding for low-byte values", () => {
  // The hex encoder pads single-digit bytes with a leading zero. We
  // exercise this by opening with a key that contains bytes < 16
  // (specifically `0x05` in every position) and round-tripping a row.
  // The check inside `applyEncryptionKey` already runs a validating
  // SELECT, so a successful open AND read confirms the hex string
  // was correctly padded.
  it("opens with a key containing bytes < 16 (padding branch)", async () => {
    const logger = new SilentLogger();
    const tmp = `/tmp/recall-hex-pad-${Date.now()}-${process.pid}.db`;
    const key: EncryptionKeyBytes = { bytes: new Uint8Array(32).fill(0x05) };
    const db = await SqliteDatabase.open({
      path: tmp,
      encryptionKey: key,
      logger,
      loadVectorExtension: false,
    });
    try {
      db.exec("CREATE TABLE t (k INTEGER); INSERT INTO t (k) VALUES (42)");
      const r = db.prepare("SELECT k FROM t").get() as { k: number };
      expect(r.k).toBe(42);
    } finally {
      db.close();
    }
    const fs = await import("node:fs/promises");
    await fs.rm(tmp, { force: true });
    await fs.rm(`${tmp}-wal`, { force: true });
    await fs.rm(`${tmp}-shm`, { force: true });
    await fs.rm(`${tmp}-journal`, { force: true });
  });
});
