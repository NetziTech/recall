import { describe, it, expect } from "vitest";

import { WorkspaceDomainError } from "../../../../../src/modules/workspace/domain/errors/workspace-domain-error.ts";
import { InvalidModeTransitionError } from "../../../../../src/modules/workspace/domain/errors/invalid-mode-transition-error.ts";
import { WorkspaceAlreadyInitializedError } from "../../../../../src/modules/workspace/domain/errors/workspace-already-initialized-error.ts";
import { WorkspaceLockedError } from "../../../../../src/modules/workspace/domain/errors/workspace-locked-error.ts";
import { WorkspaceMode } from "../../../../../src/modules/workspace/domain/value-objects/workspace-mode.ts";
import { WorkspaceId } from "../../../../../src/shared/domain/value-objects/workspace-id.ts";
import { JsonRpcErrorCodes } from "../../../../../src/shared/domain/errors/json-rpc-error-codes.ts";
import { DomainError } from "../../../../../src/shared/domain/errors/domain-error.ts";

const W_ID = "01952f3b-7d8c-7b4a-94f1-a3f8d12e5c89";

describe("WorkspaceDomainError hierarchy", () => {
  it("InvalidModeTransitionError is a WorkspaceDomainError + DomainError", () => {
    const e = new InvalidModeTransitionError(
      WorkspaceMode.encryptedMode(),
      WorkspaceMode.sharedMode(),
    );
    expect(e).toBeInstanceOf(WorkspaceDomainError);
    expect(e).toBeInstanceOf(DomainError);
    expect(e.code).toBe("workspace.invalid-mode-transition");
    expect(e.jsonRpcCode).toBeNull();
    expect(e.from.toString()).toBe("encrypted");
    expect(e.to.toString()).toBe("shared");
    expect(e.message).toContain('"encrypted"');
    expect(e.message).toContain('"shared"');
  });

  it("InvalidModeTransitionError captures cause", () => {
    const cause = new Error("u");
    const e = new InvalidModeTransitionError(
      WorkspaceMode.encryptedMode(),
      WorkspaceMode.sharedMode(),
      { cause },
    );
    expect((e as unknown as { cause: unknown }).cause).toBe(cause);
  });

  it("WorkspaceAlreadyInitializedError + cause", () => {
    const id = WorkspaceId.from(W_ID);
    const e = new WorkspaceAlreadyInitializedError(id);
    expect(e.code).toBe("workspace.already-initialized");
    expect(e.jsonRpcCode).toBeNull();
    expect(e.existingWorkspaceId.equals(id)).toBe(true);
    expect(e.message).toContain(W_ID);

    const cause = new Error("x");
    const eC = new WorkspaceAlreadyInitializedError(id, { cause });
    expect((eC as unknown as { cause: unknown }).cause).toBe(cause);
  });

  it("WorkspaceLockedError carries the JSON-RPC code -32107", () => {
    const id = WorkspaceId.from(W_ID);
    const e = new WorkspaceLockedError(id);
    expect(e.code).toBe("workspace.locked");
    expect(e.jsonRpcCode).toBe(JsonRpcErrorCodes.ENCRYPTED_LOCKED);
    expect(e.workspaceId.equals(id)).toBe(true);
    expect(e.message).toContain(W_ID);

    const cause = new Error("x");
    const eC = new WorkspaceLockedError(id, { cause });
    expect((eC as unknown as { cause: unknown }).cause).toBe(cause);
  });
});
