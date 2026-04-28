import { describe, it, expect } from "vitest";

import { WorkspaceInfrastructureError } from "../../../../../src/modules/workspace/infrastructure/errors/workspace-infrastructure-error.ts";
import { InfrastructureError } from "../../../../../src/shared/infrastructure/errors/infrastructure-error.ts";

describe("WorkspaceInfrastructureError factories", () => {
  const cause = new Error("u");

  it("configMissing", () => {
    const e = WorkspaceInfrastructureError.configMissing("/r");
    expect(e).toBeInstanceOf(InfrastructureError);
    expect(e.code).toBe("workspace.config-missing");
    expect(e.message).toContain("/r");
  });

  it("configMalformed", () => {
    const e = WorkspaceInfrastructureError.configMalformed("/r", "bad json");
    expect(e.code).toBe("workspace.config-malformed");
    expect(e.message).toContain("bad json");
  });

  it("configReadFailed", () => {
    const e = WorkspaceInfrastructureError.configReadFailed("/r", cause);
    expect(e.code).toBe("workspace.config-read-failed");
    expect((e as unknown as { cause: unknown }).cause).toBe(cause);
  });

  it("configWriteFailed", () => {
    const e = WorkspaceInfrastructureError.configWriteFailed("/r", cause);
    expect(e.code).toBe("workspace.config-write-failed");
  });

  it("directoryCreateFailed", () => {
    const e = WorkspaceInfrastructureError.directoryCreateFailed("/r", cause);
    expect(e.code).toBe("workspace.directory-create-failed");
  });

  it("gitignoreUpdateFailed", () => {
    const e = WorkspaceInfrastructureError.gitignoreUpdateFailed("/r", cause);
    expect(e.code).toBe("workspace.gitignore-update-failed");
  });

  it("detectionFailed", () => {
    const e = WorkspaceInfrastructureError.detectionFailed("/r", cause);
    expect(e.code).toBe("workspace.detection-failed");
  });

  it("unlockTargetMissing", () => {
    const e = WorkspaceInfrastructureError.unlockTargetMissing("/r");
    expect(e.code).toBe("workspace.unlock-target-missing");
  });
});
