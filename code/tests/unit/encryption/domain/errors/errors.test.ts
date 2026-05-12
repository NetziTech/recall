import { describe, it, expect } from "vitest";
import { EncryptionNotInitializedError } from "../../../../../src/modules/encryption/domain/errors/encryption-not-initialized-error.ts";
import { KeyValidationFailedError } from "../../../../../src/modules/encryption/domain/errors/key-validation-failed-error.ts";
import { LastEnvelopeRemovalError } from "../../../../../src/modules/encryption/domain/errors/last-envelope-removal-error.ts";
import { MasterKeyMismatchError } from "../../../../../src/modules/encryption/domain/errors/master-key-mismatch-error.ts";
import { WeakKdfParamsError } from "../../../../../src/modules/encryption/domain/errors/weak-kdf-params-error.ts";
import { WorkspaceId } from "../../../../../src/shared/domain/value-objects/workspace-id.ts";
import { KeyId } from "../../../../../src/modules/encryption/domain/value-objects/key-id.ts";
import { JsonRpcErrorCodes } from "../../../../../src/shared/domain/errors/json-rpc-error-codes.ts";

const WS_ID = "01952f3b-7d8c-7b4a-b4f1-a3f8d12e5c89";
const KEY_ID = "01952f3c-2222-7000-8000-aaaaaaaaaaaa";

describe("encryption errors", () => {
  it("EncryptionNotInitializedError is well-formed", () => {
    const ws = WorkspaceId.from(WS_ID);
    const e = new EncryptionNotInitializedError(ws);
    expect(e.code).toBe("encryption.not-initialized");
    expect(e.jsonRpcCode).toBeNull();
    expect(e.workspaceId).toBe(ws);
    expect(e.message).toContain(WS_ID);
  });

  it("EncryptionNotInitializedError with cause", () => {
    const cause = new Error("root");
    const e = new EncryptionNotInitializedError(
      WorkspaceId.from(WS_ID),
      cause,
    );
    expect(e.cause).toBe(cause);
  });

  it("KeyValidationFailedError uses INVALID_KEY", () => {
    const ws = WorkspaceId.from(WS_ID);
    const e = new KeyValidationFailedError(ws);
    expect(e.code).toBe("encryption.key-validation-failed");
    expect(e.jsonRpcCode).toBe(JsonRpcErrorCodes.INVALID_KEY);
    expect(e.message).not.toContain("redacted");
    expect(e.message).not.toMatch(/[0-9a-f]{32,}/i);
  });

  it("KeyValidationFailedError with cause", () => {
    const cause = new Error("root");
    const e = new KeyValidationFailedError(WorkspaceId.from(WS_ID), cause);
    expect(e.cause).toBe(cause);
  });

  it("LastEnvelopeRemovalError is well-formed", () => {
    const k = KeyId.from(KEY_ID);
    const e = new LastEnvelopeRemovalError(k);
    expect(e.code).toBe("encryption.last-envelope-removal");
    expect(e.jsonRpcCode).toBeNull();
    expect(e.keyId).toBe(k);
    expect(e.message).toContain(KEY_ID);
  });

  it("LastEnvelopeRemovalError with cause", () => {
    const cause = new Error("root");
    const e = new LastEnvelopeRemovalError(KeyId.from(KEY_ID), cause);
    expect(e.cause).toBe(cause);
  });

  it("MasterKeyMismatchError is well-formed", () => {
    const k = KeyId.from(KEY_ID);
    const e = new MasterKeyMismatchError(k);
    expect(e.code).toBe("encryption.master-key-mismatch");
    expect(e.jsonRpcCode).toBeNull();
    expect(e.keyId).toBe(k);
    // No key bytes in message:
    expect(e.message).not.toMatch(/[0-9a-f]{20,}/);
  });

  it("MasterKeyMismatchError with cause", () => {
    const cause = new Error("root");
    const e = new MasterKeyMismatchError(KeyId.from(KEY_ID), cause);
    expect(e.cause).toBe(cause);
  });

  it("WeakKdfParamsError exposes parameter, actual, minimum", () => {
    const e = new WeakKdfParamsError({
      parameter: "memory_kib",
      actual: 32768,
      minimum: 65536,
    });
    expect(e.code).toBe("encryption.weak-kdf-params");
    expect(e.jsonRpcCode).toBeNull();
    expect(e.parameter).toBe("memory_kib");
    expect(e.actual).toBe(32768);
    expect(e.minimum).toBe(65536);
    expect(e.message).toContain("memory_kib");
    expect(e.message).toContain("32768");
    expect(e.message).toContain("65536");
  });

  it("WeakKdfParamsError with cause", () => {
    const cause = new Error("root");
    const e = new WeakKdfParamsError(
      {
        parameter: "iterations",
        actual: 1,
        minimum: 3,
      },
      cause,
    );
    expect(e.cause).toBe(cause);
  });
});
