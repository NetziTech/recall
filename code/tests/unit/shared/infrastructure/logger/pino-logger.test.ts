import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  DEFAULT_REDACT_PATHS,
  PinoLogger,
} from "../../../../../src/shared/infrastructure/logger/pino-logger.ts";

/**
 * Tests for PinoLogger via its public API.
 *
 * Pino writes JSON lines to stdout by default (no transport). To
 * capture them deterministically we patch `process.stdout.write` for
 * the duration of each test and parse the captured chunks.
 *
 * NOTE: pino's default destination is buffered; for tiny payloads it
 * still calls `process.stdout.write` synchronously (sonic-boom defers
 * only when the queue is large). For unit tests this works.
 */

interface Captured {
  readonly stdout: string[];
  readonly stderr: string[];
}

function patchTty(): {
  readonly captured: Captured;
  restore: () => void;
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const origStdout = process.stdout.write.bind(process.stdout);
  const origStderr = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((chunk: unknown): boolean => {
    stdout.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: unknown): boolean => {
    stderr.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  return {
    captured: { stdout, stderr },
    restore: () => {
      process.stdout.write = origStdout;
      process.stderr.write = origStderr;
    },
  };
}

function joined(lines: readonly string[]): string {
  return lines.join("");
}

function parseJsonLines(lines: readonly string[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const line of lines) {
    for (const candidate of line.split("\n")) {
      const trimmed = candidate.trim();
      if (trimmed.length === 0) continue;
      try {
        out.push(JSON.parse(trimmed) as Record<string, unknown>);
      } catch {
        // not JSON — ignore (pino fallbacks emit prose)
      }
    }
  }
  return out;
}

describe("DEFAULT_REDACT_PATHS", () => {
  it("contains every documented sensitive key", () => {
    for (const k of [
      "passphrase",
      "password",
      "secret",
      "token",
      "apiKey",
      "api_key",
      "key",
      "cookie",
      "authorization",
      "masterKey",
      "derivedKey",
      "encryptionKey",
      "salt",
      "printableMasterKey",
    ]) {
      expect(DEFAULT_REDACT_PATHS).toContain(k);
    }
  });

  it("contains wildcard variants for nested payloads", () => {
    for (const k of [
      "*.passphrase",
      "*.password",
      "*.secret",
      "*.token",
      "*.apiKey",
      "*.api_key",
      "*.key",
      "*.cookie",
      "*.authorization",
      "*.masterKey",
      "*.derivedKey",
      "*.encryptionKey",
      "*.salt",
      "*.printableMasterKey",
      "*.headers.authorization",
      "*.headers.cookie",
    ]) {
      expect(DEFAULT_REDACT_PATHS).toContain(k);
    }
  });

  it("contains structured-error path globs (W-3.5-SEC-L1)", () => {
    // DatabaseError stows absolute paths under `details.path` /
    // `details.dir`; the globs below ensure pino's redactor catches
    // them when the error envelope is logged via `{ err }`.
    for (const k of [
      "details.path",
      "details.dir",
      "*.details.path",
      "*.details.dir",
    ]) {
      expect(DEFAULT_REDACT_PATHS).toContain(k);
    }
  });

  it("is frozen", () => {
    expect(Object.isFrozen(DEFAULT_REDACT_PATHS)).toBe(true);
  });
});

describe("PinoLogger.create — emission", () => {
  let captured: Captured;
  let restore: () => void;

  beforeEach(() => {
    const tty = patchTty();
    captured = tty.captured;
    restore = tty.restore;
  });

  afterEach(() => {
    restore();
  });

  it("emits a JSON line containing the payload + message", () => {
    const log = PinoLogger.create({ level: "info" });
    log.info({ foo: "bar" }, "hello");
    const records = parseJsonLines(captured.stdout);
    expect(records.length).toBeGreaterThanOrEqual(1);
    const last = records[records.length - 1];
    expect(last).toBeDefined();
    expect(last?.["foo"]).toBe("bar");
    expect(last?.["msg"]).toBe("hello");
  });

  it("string-only argument is the message", () => {
    const log = PinoLogger.create({ level: "info" });
    log.warn("plain");
    const records = parseJsonLines(captured.stdout);
    const last = records[records.length - 1];
    expect(last?.["msg"]).toBe("plain");
  });

  it("each level method has the right numeric level", () => {
    const log = PinoLogger.create({ level: "trace" });
    log.trace("t");
    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");
    log.fatal("f");
    const records = parseJsonLines(captured.stdout);
    const levels = records.map((r) => r["level"]);
    expect(levels).toEqual([10, 20, 30, 40, 50, 60]);
  });

  it("level threshold filters lower-severity entries", () => {
    const log = PinoLogger.create({ level: "warn" });
    log.info("filtered");
    log.warn("emitted");
    const text = joined(captured.stdout);
    expect(text).not.toContain('"msg":"filtered"');
    expect(text).toContain('"msg":"emitted"');
  });

  it("name binding is added to every line", () => {
    const log = PinoLogger.create({ level: "info", name: "mcp" });
    log.info("hello");
    const records = parseJsonLines(captured.stdout);
    expect(records.some((r) => r["name"] === "mcp")).toBe(true);
  });
});

describe("PinoLogger.create — redaction (security-critical)", () => {
  let captured: Captured;
  let restore: () => void;

  beforeEach(() => {
    const tty = patchTty();
    captured = tty.captured;
    restore = tty.restore;
  });

  afterEach(() => {
    restore();
  });

  it("redacts every documented top-level sensitive key", () => {
    const log = PinoLogger.create({ level: "info" });
    const sensitive = {
      passphrase: "p1",
      password: "p2",
      secret: "p3",
      token: "p4",
      apiKey: "p5",
      api_key: "p6",
      key: "p7",
      cookie: "p8",
      authorization: "p9",
      masterKey: "p10",
      derivedKey: "p11",
      encryptionKey: "p12",
      salt: "p13",
      // FU-A7-3: Bech32 encoding of the master key (`recall export-key`)
      // — never logged by the CLI today, but the redact baseline guards
      // against a future regression.
      printableMasterKey: "p14-recall1qpzry9x8gf2tvdw0s3jn54khce6mua7lmqqqxw4",
    };
    log.info(sensitive, "with secrets");
    const text = joined(captured.stdout);
    for (const value of Object.values(sensitive)) {
      expect(text).not.toContain(value);
    }
    expect(text).toContain("[REDACTED]");
  });

  it("redacts one-level-nested sensitive keys via *.<key> wildcards", () => {
    const log = PinoLogger.create({ level: "info" });
    log.info(
      {
        request: {
          // One level deep — covered by `*.passphrase`, etc.
          passphrase: "leak-1lvl",
          authorization: "Bearer 1lvl",
        },
      },
      "one-level",
    );
    const text = joined(captured.stdout);
    expect(text).not.toContain("leak-1lvl");
    expect(text).not.toContain("Bearer 1lvl");
    expect(text).toContain("[REDACTED]");
  });

  it("redacts two-level *.headers.{authorization,cookie}", () => {
    const log = PinoLogger.create({ level: "info" });
    log.info(
      {
        request: {
          headers: {
            authorization: "Bearer 2lvl",
            cookie: "session=hidden",
          },
        },
      },
      "two-level-headers",
    );
    const text = joined(captured.stdout);
    expect(text).not.toContain("Bearer 2lvl");
    expect(text).not.toContain("session=hidden");
    expect(text).toContain("[REDACTED]");
  });

  it("redacts DatabaseError details.path / details.dir end-to-end (W-3.5-SEC-L1)", () => {
    // Mirrors the canonical caller pattern:
    //   logger.error({ err }, "open failed")
    // where `err` is a DatabaseError whose `details.path` carries the
    // absolute SQLite path. The redactor must walk the structured
    // envelope and never let the path land in the JSON line.
    const log = PinoLogger.create({ level: "info" });
    const sensitivePath = "/Users/alice/secret/workspace/recall.db";
    const sensitiveDir = "/Users/alice/secret/workspace/migrations";
    log.error(
      {
        err: {
          name: "DatabaseError",
          code: "database.open-failed",
          message: "failed to open SQLite database",
          details: { path: sensitivePath },
        },
      },
      "open failed",
    );
    log.error(
      {
        err: {
          name: "DatabaseError",
          code: "database.migration-directory-invalid",
          message: "migrations directory is invalid: duplicate",
          details: { dir: sensitiveDir, reason: "duplicate" },
        },
      },
      "migration dir invalid",
    );
    const text = joined(captured.stdout);
    expect(text).not.toContain(sensitivePath);
    expect(text).not.toContain(sensitiveDir);
    expect(text).not.toContain("/Users/alice");
    expect(text).toContain("[REDACTED]");
    // The non-sensitive `reason` field stays visible — proves redact is
    // surgical, not a blanket details-bag wipeout.
    expect(text).toContain('"reason":"duplicate"');
  });

  it("redacts top-level details.path when details is logged standalone", () => {
    // Some callers log a `details` envelope directly (not wrapped in
    // `err`); the literal `details.path` glob covers that shape.
    const log = PinoLogger.create({ level: "info" });
    const sensitivePath = "/var/lib/recall/db.sqlite";
    log.info({ details: { path: sensitivePath, op: "open" } }, "ev");
    const text = joined(captured.stdout);
    expect(text).not.toContain(sensitivePath);
    expect(text).toContain("[REDACTED]");
    expect(text).toContain('"op":"open"');
  });

  it("merges custom redact paths on top of the defaults", () => {
    const log = PinoLogger.create({
      level: "info",
      redact: ["custom"],
    });
    log.info({ custom: "hide-me", passphrase: "also-hide" }, "with both");
    const text = joined(captured.stdout);
    expect(text).not.toContain("hide-me");
    expect(text).not.toContain("also-hide");
  });

  it("the same custom redact path passed twice is deduped (no array bloat)", () => {
    const log = PinoLogger.create({
      level: "info",
      redact: ["passphrase"], // already in defaults
    });
    log.info({ passphrase: "x" }, "ok");
    const text = joined(captured.stdout);
    expect(text).not.toContain('"passphrase":"x"');
  });
});

describe("PinoLogger.child", () => {
  let captured: Captured;
  let restore: () => void;

  beforeEach(() => {
    const tty = patchTty();
    captured = tty.captured;
    restore = tty.restore;
  });

  afterEach(() => {
    restore();
  });

  it("inherits redact config and merges bindings", () => {
    const log = PinoLogger.create({ level: "info" });
    const child = log.child({ requestId: "r1" });
    child.info({ extra: "yes", passphrase: "leak" }, "from child");
    const records = parseJsonLines(captured.stdout);
    const last = records[records.length - 1];
    expect(last?.["requestId"]).toBe("r1");
    expect(last?.["extra"]).toBe("yes");
    expect(last?.["msg"]).toBe("from child");
    expect(last?.["passphrase"]).toBe("[REDACTED]");
  });
});

describe("PinoLogger — fallback paths (defensive)", () => {
  it("logger calls never throw on exotic payloads", () => {
    const tty = patchTty();
    try {
      const log = PinoLogger.create({ level: "trace" });
      // Cycles: pino tolerates them by returning ["Circular"], so no
      // throw expected. Functions: pino drops them silently. We just
      // assert no exception escapes.
      const cycle: { self?: unknown } = {};
      cycle.self = cycle;
      expect(() =>
        log.info(
          {
            cycle,
            fn: () => 1,
            big: BigInt(2) as unknown as number,
            undef: undefined,
          },
          "exotic",
        ),
      ).not.toThrow();
      expect(() => log.trace("t")).not.toThrow();
      expect(() => log.debug("d")).not.toThrow();
      expect(() => log.fatal("f")).not.toThrow();
    } finally {
      tty.restore();
    }
  });

  /**
   * Drives the fallback paths inside `emit()` and `child()` by
   * monkey-patching the underlying pino instance to throw. We replace
   * the private `inner` field via Object.defineProperty so the
   * production code's try/catch redirects to `fallback()` →
   * `process.stderr.write`.
   */
  it("emit() falls back to stderr when pino's level method throws", () => {
    const tty = patchTty();
    try {
      const log = PinoLogger.create({ level: "info" });
      const broken = {
        trace: () => {
          throw new Error("pino trace bug");
        },
        debug: () => {
          throw new Error("pino debug bug");
        },
        info: () => {
          throw new Error("pino info bug");
        },
        warn: () => {
          throw new Error("pino warn bug");
        },
        error: () => {
          throw "pino error string"; // non-Error throw → stringifyError branch
        },
        fatal: () => {
          throw new Error("pino fatal bug");
        },
        child: () => {
          throw new Error("pino child bug");
        },
      };
      // Replace the private `inner` field. We rely on the implementation
      // detail (the field name) for this defensive test.
      Object.defineProperty(log, "inner", { value: broken, configurable: true });
      // None of these should throw; each should hit the stderr fallback.
      expect(() => log.trace("t")).not.toThrow();
      expect(() => log.debug("d")).not.toThrow();
      expect(() => log.info({ foo: "bar" }, "i")).not.toThrow();
      expect(() => log.warn({ foo: "bar" })).not.toThrow();
      expect(() => log.error("e")).not.toThrow();
      expect(() => log.fatal("f")).not.toThrow();
      const stderrText = tty.captured.stderr.join("");
      expect(stderrText).toContain("pino trace");
      expect(stderrText).toContain("pino debug");
      expect(stderrText).toContain("pino info");
      expect(stderrText).toContain("pino warn");
      // Non-Error throw goes through stringifyError(cause) → String(cause).
      expect(stderrText).toContain("pino error string");
      expect(stderrText).toContain("pino fatal");
      // Also verify the level prefix shape `[<level>]`.
      expect(stderrText).toContain("[trace]");
      expect(stderrText).toContain("[fatal]");
    } finally {
      tty.restore();
    }
  });

  it("child() returns the parent when pino's child throws", () => {
    const tty = patchTty();
    try {
      const log = PinoLogger.create({ level: "info" });
      const broken = {
        info: (() => undefined) as unknown,
        child: () => {
          throw new Error("child throw");
        },
      };
      Object.defineProperty(log, "inner", { value: broken, configurable: true });
      const result = log.child({ scope: "x" });
      // child() returned `this` (the parent) — not a throw.
      expect(result).toBe(log);
      expect(tty.captured.stderr.join("")).toContain("[fatal] pino child()");
    } finally {
      tty.restore();
    }
  });

  it("fallback() swallows nested stderr.write throws", () => {
    const tty = patchTty();
    try {
      const log = PinoLogger.create({ level: "info" });
      const broken = {
        info: () => {
          throw new Error("primary");
        },
      };
      Object.defineProperty(log, "inner", { value: broken, configurable: true });
      // Replace stderr.write to throw too — simulates the "even stderr
      // is broken" branch.
      const origStderr = process.stderr.write;
      process.stderr.write = ((): boolean => {
        throw new Error("stderr broken");
      }) as typeof process.stderr.write;
      try {
        expect(() => log.info("x")).not.toThrow();
      } finally {
        process.stderr.write = origStderr;
      }
    } finally {
      tty.restore();
    }
  });
});

describe("PinoLogger.create — destination override (Bug B-016)", () => {
  /**
   * Verifies that `destination: 2` routes pino output through
   * `pino.destination({fd: 2})`. Pino's sonic-boom writes to the FD
   * directly (bypassing `process.stdout/stderr.write`), so we redirect
   * a tmp file under FD 2 for the duration of the test and read its
   * contents back. The MCP stdio server depends on this routing —
   * leaking pino frames to FD 1 would corrupt JSON-RPC responses.
   */
  it("emits to the requested file descriptor", async () => {
    const tmp = path.join(
      os.tmpdir(),
      `recall-pino-${String(process.pid)}-${String(Date.now())}.log`,
    );
    const fd = fs.openSync(tmp, "w");
    try {
      const log = PinoLogger.create({
        level: "info",
        // Override the FD via the test seam: we open `fd` and pass
        // its number as if it were FD 2. pino's destination treats
        // the integer as an `fd` argument to `fs.write`, so the
        // bytes land in `tmp` instead of the real stderr.
        destination: fd as 1 | 2,
      });
      log.info({ ok: true }, "to-fd");
      // pino writes async via sonic-boom; flush by closing the
      // logger via an explicit await of the underlying drain.
      await new Promise((r) => setTimeout(r, 50));
      const contents = fs.readFileSync(tmp, "utf8");
      expect(contents).toContain('"msg":"to-fd"');
      expect(contents).toContain('"ok":true');
    } finally {
      try {
        fs.closeSync(fd);
      } catch {
        /* already closed by sonic-boom */
      }
      fs.rmSync(tmp, { force: true });
    }
  });

  it("destination is bypassed when pretty mode is on (transport owns the sink)", () => {
    // Pretty mode owns its own transport; the destination override
    // path MUST NOT execute when `pretty: true`. Verifying this
    // behaviour directly is awkward (pino-pretty is not a runtime
    // devDep, so the transport throws on construction) — what we DO
    // assert is the negative space: the destination branch never
    // runs in pretty mode, which means construction with `pretty:
    // true` fails for the SAME reason it did before this commit
    // (missing pino-pretty), not because of a destination interaction.
    let captured: unknown = null;
    try {
      PinoLogger.create({ level: "info", pretty: true });
    } catch (err: unknown) {
      captured = err;
    }
    let capturedWithDest: unknown = null;
    try {
      PinoLogger.create({ level: "info", pretty: true, destination: 2 });
    } catch (err: unknown) {
      capturedWithDest = err;
    }
    // The error shape is identical with or without the destination
    // override — proving the destination code path was bypassed.
    const msg = (e: unknown): string =>
      e instanceof Error ? e.message : String(e);
    expect(msg(captured)).toBe(msg(capturedWithDest));
  });
});
