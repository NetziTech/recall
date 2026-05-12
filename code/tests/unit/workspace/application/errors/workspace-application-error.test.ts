import { describe, it, expect } from "vitest";

import {
  NoWorkspaceAtPathError,
  WorkspaceApplicationError,
} from "../../../../../src/modules/workspace/application/errors/workspace-application-error.ts";
import { DomainError } from "../../../../../src/shared/domain/errors/domain-error.ts";

describe("WorkspaceApplicationError hierarchy", () => {
  it("NoWorkspaceAtPathError extends WorkspaceApplicationError + DomainError", () => {
    const e = new NoWorkspaceAtPathError("/no/such");
    expect(e).toBeInstanceOf(WorkspaceApplicationError);
    expect(e).toBeInstanceOf(DomainError);
    expect(e.code).toBe("workspace.app.no-workspace-at-path");
    expect(e.rootPath).toBe("/no/such");
    expect(e.message).toContain("/no/such");
  });

  it("preserves cause when provided", () => {
    const cause = new Error("u");
    const e = new NoWorkspaceAtPathError("/x", cause);
    expect((e as unknown as { cause: unknown }).cause).toBe(cause);
  });
});
