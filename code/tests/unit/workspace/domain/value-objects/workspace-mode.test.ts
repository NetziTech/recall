import { describe, it, expect } from "vitest";

import { WorkspaceMode } from "../../../../../src/modules/workspace/domain/value-objects/workspace-mode.ts";
import { InvalidInputError } from "../../../../../src/shared/domain/errors/invalid-input-error.ts";

describe("WorkspaceMode", () => {
  it("create accepts the three valid modes (trimmed)", () => {
    expect(WorkspaceMode.create("shared").kind).toBe("shared");
    expect(WorkspaceMode.create("encrypted").kind).toBe("encrypted");
    expect(WorkspaceMode.create("private").kind).toBe("private");
    expect(WorkspaceMode.create("  shared  ").kind).toBe("shared");
  });

  it("create rejects empty / whitespace / wrong shapes", () => {
    expect(() => WorkspaceMode.create("")).toThrow(InvalidInputError);
    expect(() => WorkspaceMode.create("   ")).toThrow(InvalidInputError);
    expect(() => WorkspaceMode.create("Shared")).toThrow(InvalidInputError);
    expect(() => WorkspaceMode.create("public")).toThrow(InvalidInputError);
  });

  it("create rejects non-string", () => {
    expect(() =>
      WorkspaceMode.create(undefined as unknown as string),
    ).toThrow(InvalidInputError);
  });

  it("convenience factories", () => {
    expect(WorkspaceMode.sharedMode().kind).toBe("shared");
    expect(WorkspaceMode.encryptedMode().kind).toBe("encrypted");
    expect(WorkspaceMode.privateMode().kind).toBe("private");
  });

  it("isKind type guard", () => {
    expect(WorkspaceMode.isKind("shared")).toBe(true);
    expect(WorkspaceMode.isKind("encrypted")).toBe(true);
    expect(WorkspaceMode.isKind("private")).toBe(true);
    expect(WorkspaceMode.isKind("public")).toBe(false);
  });

  it("predicate methods + requiresKey", () => {
    expect(WorkspaceMode.sharedMode().isShared()).toBe(true);
    expect(WorkspaceMode.sharedMode().isEncrypted()).toBe(false);
    expect(WorkspaceMode.sharedMode().isPrivate()).toBe(false);
    expect(WorkspaceMode.sharedMode().requiresKey()).toBe(false);

    expect(WorkspaceMode.encryptedMode().isEncrypted()).toBe(true);
    expect(WorkspaceMode.encryptedMode().requiresKey()).toBe(true);

    expect(WorkspaceMode.privateMode().isPrivate()).toBe(true);
    expect(WorkspaceMode.privateMode().requiresKey()).toBe(false);
  });

  it("toString + equals", () => {
    const a = WorkspaceMode.sharedMode();
    const b = WorkspaceMode.sharedMode();
    expect(a.toString()).toBe("shared");
    expect(a.equals(b)).toBe(true);
    expect(a.equals(WorkspaceMode.privateMode())).toBe(false);
  });
});
