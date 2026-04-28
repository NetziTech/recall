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
    const e = new TestInfraError("wrap", { cause });
    expect((e as unknown as { cause: unknown }).cause).toBe(cause);
  });

  it("does not set cause when not provided", () => {
    const e = new TestInfraError("plain");
    expect((e as unknown as { cause?: unknown }).cause).toBeUndefined();
  });
});

describe("DatabaseError factories", () => {
  it("openFailed", () => {
    const e = DatabaseError.openFailed("/tmp/db", new Error("ENOSPC"));
    expect(e.code).toBe("database.open-failed");
    expect(e.message).toContain("/tmp/db");
  });

  it("encryptionKeyRejected", () => {
    const e = DatabaseError.encryptionKeyRejected(new Error("bad"));
    expect(e.code).toBe("database.encryption-key-rejected");
  });

  it("extensionLoadFailed", () => {
    const e = DatabaseError.extensionLoadFailed("sqlite-vec", new Error("x"));
    expect(e.code).toBe("database.extension-load-failed");
    expect(e.message).toContain("sqlite-vec");
  });

  it("prepareFailed", () => {
    const e = DatabaseError.prepareFailed("SELECT 1", new Error("syntax"));
    expect(e.code).toBe("database.prepare-failed");
    expect(e.message).toContain("8"); // sql length
  });

  it("execFailed", () => {
    const e = DatabaseError.execFailed(new Error("x"));
    expect(e.code).toBe("database.exec-failed");
  });

  it("transactionFailed", () => {
    const e = DatabaseError.transactionFailed(new Error("x"));
    expect(e.code).toBe("database.transaction-failed");
  });

  it("connectionClosed", () => {
    const e = DatabaseError.connectionClosed("prepare");
    expect(e.code).toBe("database.connection-closed");
    expect(e.message).toContain("prepare");
  });

  it("migrationAheadOfCode", () => {
    const e = DatabaseError.migrationAheadOfCode(5, 3);
    expect(e.code).toBe("database.migration-ahead-of-code");
    expect(e.message).toContain("5");
    expect(e.message).toContain("3");
  });

  it("migrationFailed", () => {
    const e = DatabaseError.migrationFailed(2, "core", new Error("x"));
    expect(e.code).toBe("database.migration-failed");
    expect(e.message).toContain("2");
    expect(e.message).toContain("core");
  });

  it("migrationDirectoryInvalid", () => {
    const e = DatabaseError.migrationDirectoryInvalid("/tmp", "duplicate");
    expect(e.code).toBe("database.migration-directory-invalid");
    expect(e.message).toContain("/tmp");
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
