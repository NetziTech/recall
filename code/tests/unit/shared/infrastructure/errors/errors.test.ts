import { describe, it, expect } from "vitest";

import { InfrastructureError } from "../../../../../src/shared/infrastructure/errors/infrastructure-error.ts";
import { DatabaseError } from "../../../../../src/shared/infrastructure/errors/database-error.ts";
import { EmbedderError } from "../../../../../src/shared/infrastructure/errors/embedder-error.ts";

class TestInfraError extends InfrastructureError {
  public readonly code = "test.infra";
  public constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

describe("InfrastructureError", () => {
  it("subclass carries name + code + message", () => {
    const e = new TestInfraError("oops");
    expect(e).toBeInstanceOf(InfrastructureError);
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("TestInfraError");
    expect(e.code).toBe("test.infra");
    expect(e.message).toBe("oops");
  });

  it("preserves cause when provided", () => {
    const cause = new Error("u");
    const e = new TestInfraError("wrap", cause);
    expect((e as unknown as { cause: unknown }).cause).toBe(cause);
  });

  it("does not set cause when not provided", () => {
    const e = new TestInfraError("plain");
    expect((e as unknown as { cause?: unknown }).cause).toBeUndefined();
  });
});

describe("DatabaseError factories", () => {
  it("openFailed keeps the absolute path out of message and exposes it via details", () => {
    const sensitivePath = "/Users/alice/secret/workspace/recall.db";
    const e = DatabaseError.openFailed(sensitivePath, new Error("ENOSPC"));
    expect(e.code).toBe("database.open-failed");
    // VALOR (W-3.5-SEC-L1): the path MUST NOT appear in `message` so
    // that pino's redactor (which only walks structured fields) can
    // redact it when this error is logged via `logger.error({ err })`.
    expect(e.message).not.toContain(sensitivePath);
    expect(e.message).not.toContain("/Users/alice");
    expect(e.message).toBe("failed to open SQLite database");
    // The path is still accessible via the structured side-channel
    // for callers that need it (e.g. UI surfaces, debugging tools).
    expect(e.details["path"]).toBe(sensitivePath);
  });

  it("encryptionKeyRejected", () => {
    const e = DatabaseError.encryptionKeyRejected(new Error("bad"));
    expect(e.code).toBe("database.encryption-key-rejected");
    expect(e.details).toEqual({});
  });

  it("extensionLoadFailed", () => {
    const e = DatabaseError.extensionLoadFailed("sqlite-vec", new Error("x"));
    expect(e.code).toBe("database.extension-load-failed");
    expect(e.message).toContain("sqlite-vec");
    expect(e.details["extensionName"]).toBe("sqlite-vec");
  });

  it("prepareFailed", () => {
    const e = DatabaseError.prepareFailed("SELECT 1", new Error("syntax"));
    expect(e.code).toBe("database.prepare-failed");
    expect(e.message).toContain("8"); // sql length
    expect(e.details["sqlLength"]).toBe(8);
  });

  it("execFailed", () => {
    const e = DatabaseError.execFailed(new Error("x"));
    expect(e.code).toBe("database.exec-failed");
    expect(e.details).toEqual({});
  });

  it("transactionFailed", () => {
    const e = DatabaseError.transactionFailed(new Error("x"));
    expect(e.code).toBe("database.transaction-failed");
    expect(e.details).toEqual({});
  });

  it("connectionClosed", () => {
    const e = DatabaseError.connectionClosed("prepare");
    expect(e.code).toBe("database.connection-closed");
    expect(e.message).toContain("prepare");
    expect(e.details["operation"]).toBe("prepare");
  });

  it("migrationAheadOfCode", () => {
    const e = DatabaseError.migrationAheadOfCode(5, 3);
    expect(e.code).toBe("database.migration-ahead-of-code");
    expect(e.message).toContain("5");
    expect(e.message).toContain("3");
    expect(e.details["dbVersion"]).toBe(5);
    expect(e.details["codeMaxVersion"]).toBe(3);
  });

  it("migrationFailed", () => {
    const e = DatabaseError.migrationFailed(2, "core", new Error("x"));
    expect(e.code).toBe("database.migration-failed");
    expect(e.message).toContain("2");
    expect(e.message).toContain("core");
    expect(e.details["version"]).toBe(2);
    expect(e.details["name"]).toBe("core");
  });

  it("migrationDirectoryInvalid keeps the directory path out of message and exposes it via details", () => {
    const sensitiveDir = "/Users/alice/secret/workspace/migrations";
    const e = DatabaseError.migrationDirectoryInvalid(
      sensitiveDir,
      "duplicate migration version 1",
    );
    expect(e.code).toBe("database.migration-directory-invalid");
    // VALOR (W-3.5-SEC-L1): the absolute path MUST NOT leak into the
    // message — only the reason (which the call sites construct from
    // safe content like "duplicate migration version N") is visible.
    expect(e.message).not.toContain(sensitiveDir);
    expect(e.message).not.toContain("/Users/alice");
    expect(e.message).toBe(
      "migrations directory is invalid: duplicate migration version 1",
    );
    expect(e.details["dir"]).toBe(sensitiveDir);
    expect(e.details["reason"]).toBe("duplicate migration version 1");
  });

  it("backward-compat: callers pivot from message-substring to details for paths", () => {
    // Documents the migration path for callers/tests that previously
    // pinned the absolute path via `error.message.includes(...)`. The
    // new contract is `error.details.path` for openFailed and
    // `error.details.dir` for migrationDirectoryInvalid.
    const dbPath = "/var/lib/recall/db.sqlite";
    const openErr = DatabaseError.openFailed(dbPath, new Error("x"));
    expect(openErr.details["path"]).toBe(dbPath);

    const migDir = "/var/lib/recall/migrations";
    const migErr = DatabaseError.migrationDirectoryInvalid(migDir, "empty");
    expect(migErr.details["dir"]).toBe(migDir);
  });
});

describe("EmbedderError factories", () => {
  it("notInitialised", () => {
    const e = EmbedderError.notInitialised("dimension");
    expect(e.code).toBe("embedder.not-initialised");
    expect(e.message).toContain("dimension");
  });

  it("initialisationFailed", () => {
    const e = EmbedderError.initialisationFailed(new Error("x"));
    expect(e.code).toBe("embedder.initialisation-failed");
  });

  it("embedFailed", () => {
    const e = EmbedderError.embedFailed(new Error("x"));
    expect(e.code).toBe("embedder.embed-failed");
  });

  it("dimensionMismatch", () => {
    const e = EmbedderError.dimensionMismatch(384, 768);
    expect(e.code).toBe("embedder.dimension-mismatch");
    expect(e.message).toContain("768");
    expect(e.message).toContain("384");
  });
});
