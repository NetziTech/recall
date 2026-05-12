import { describe, it, expect } from "vitest";

import { DomainError } from "../../../../../src/shared/domain/errors/domain-error.ts";
import { InvalidInputError } from "../../../../../src/shared/domain/errors/invalid-input-error.ts";
import { InvariantViolationError } from "../../../../../src/shared/domain/errors/invariant-violation-error.ts";
import {
  JsonRpcErrorCodes,
  type JsonRpcErrorCode,
} from "../../../../../src/shared/domain/errors/json-rpc-error-codes.ts";

class TestDomainError extends DomainError {
  public readonly code = "test.code";
  public constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

describe("DomainError", () => {
  it("is abstract — only subclasses can be instantiated", () => {
    const err = new TestDomainError("oops");
    expect(err).toBeInstanceOf(DomainError);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("oops");
    expect(err.name).toBe("TestDomainError");
    expect(err.code).toBe("test.code");
  });

  it("preserves cause when provided", () => {
    const cause = new Error("under");
    const err = new TestDomainError("wrap", cause);
    expect((err as unknown as { cause: unknown }).cause).toBe(cause);
  });

  it("does not set cause when not provided", () => {
    const err = new TestDomainError("plain");
    expect((err as unknown as { cause?: unknown }).cause).toBeUndefined();
  });
});

describe("InvalidInputError", () => {
  it("code = invalid-input", () => {
    const err = new InvalidInputError("bad");
    expect(err.code).toBe("invalid-input");
    expect(err.field).toBeNull();
  });

  it("captures field when provided", () => {
    const err = new InvalidInputError("bad", { field: "x" });
    expect(err.field).toBe("x");
  });

  it("captures cause when provided", () => {
    const cause = new Error("u");
    const err = new InvalidInputError("bad", undefined, cause);
    expect((err as unknown as { cause: unknown }).cause).toBe(cause);
  });
});

describe("InvariantViolationError", () => {
  it("code = invariant-violation", () => {
    const err = new InvariantViolationError("violation");
    expect(err.code).toBe("invariant-violation");
    expect(err.invariant).toBeNull();
  });

  it("captures invariant name when provided", () => {
    const err = new InvariantViolationError("v", { invariant: "rule.foo" });
    expect(err.invariant).toBe("rule.foo");
  });

  it("captures cause when provided", () => {
    const cause = new Error("u");
    const err = new InvariantViolationError("v", undefined, cause);
    expect((err as unknown as { cause: unknown }).cause).toBe(cause);
  });
});

describe("JsonRpcErrorCodes", () => {
  it("exposes the documented project-specific codes", () => {
    expect(JsonRpcErrorCodes.WORKSPACE_NOT_FOUND).toBe(-32100);
    expect(JsonRpcErrorCodes.SESSION_EXPIRED).toBe(-32101);
    expect(JsonRpcErrorCodes.EMBEDDING_SERVICE_UNAVAILABLE).toBe(-32102);
    expect(JsonRpcErrorCodes.DISK_FULL).toBe(-32103);
    expect(JsonRpcErrorCodes.SCHEMA_VERSION_INCOMPATIBLE).toBe(-32104);
    expect(JsonRpcErrorCodes.SECRET_DETECTED).toBe(-32105);
    expect(JsonRpcErrorCodes.RATE_LIMITED).toBe(-32106);
    expect(JsonRpcErrorCodes.ENCRYPTED_LOCKED).toBe(-32107);
    expect(JsonRpcErrorCodes.INVALID_KEY).toBe(-32108);
    expect(JsonRpcErrorCodes.KEY_REVOKED).toBe(-32109);
  });

  it("JsonRpcErrorCode is the union of values", () => {
    const valid: JsonRpcErrorCode = JsonRpcErrorCodes.WORKSPACE_NOT_FOUND;
    expect(valid).toBe(-32100);
  });
});
