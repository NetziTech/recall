import { describe, it, expect } from "vitest";

import {
  NoWorkspaceAtPathError,
  WorkspaceApplicationError,
} from "../../../../../src/modules/workspace/application/errors/workspace-application-error.ts";
import { DomainError } from "../../../../../src/shared/domain/errors/domain-error.ts";

describe("WorkspaceApplicationError hierarchy", () => {
  it("NoWorkspaceAtPathError extends WorkspaceApplicationError + DomainError", () => {
    const ROOT = "/abs/no/such/workspace";
    const e = new NoWorkspaceAtPathError(ROOT);
    expect(e).toBeInstanceOf(WorkspaceApplicationError);
    expect(e).toBeInstanceOf(DomainError);
    expect(e.code).toBe("workspace.app.no-workspace-at-path");
  });

  it("keeps the absolute path out of message and into details.path", () => {
    const ROOT = "/abs/no/such/workspace";
    const e = new NoWorkspaceAtPathError(ROOT);
    expect(e.message).not.toContain(ROOT);
    expect(e.details).toEqual({ path: ROOT });
    expect(e.message).toContain('run "recall init"');
  });

  it("preserves cause when provided", () => {
    const cause = new Error("u");
    const e = new NoWorkspaceAtPathError("/x", cause);
    expect((e as unknown as { cause: unknown }).cause).toBe(cause);
  });
});
