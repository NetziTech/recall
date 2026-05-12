import { describe, it, expect } from "vitest";

import { WorkspaceInfrastructureError } from "../../../../../src/modules/workspace/infrastructure/errors/workspace-infrastructure-error.ts";
import { InfrastructureError } from "../../../../../src/shared/infrastructure/errors/infrastructure-error.ts";

describe("WorkspaceInfrastructureError factories", () => {
  const cause = new Error("u");
  const ROOT = "/abs/secret/workspace/root";

  it("configMissing puts the path in details, not in message", () => {
    const e = WorkspaceInfrastructureError.configMissing(ROOT);
    expect(e).toBeInstanceOf(InfrastructureError);
    expect(e.code).toBe("workspace.config-missing");
    expect(e.message).not.toContain(ROOT);
    expect(e.details).toEqual({ path: ROOT });
  });

  it("configMalformed puts the path in details and preserves detail string", () => {
    const e = WorkspaceInfrastructureError.configMalformed(ROOT, "bad json");
    expect(e.code).toBe("workspace.config-malformed");
    expect(e.message).toContain("bad json");
    expect(e.message).not.toContain(ROOT);
    expect(e.details).toEqual({ path: ROOT, detail: "bad json" });
  });

  it("configReadFailed puts the path in details and preserves cause", () => {
    const e = WorkspaceInfrastructureError.configReadFailed(ROOT, cause);
    expect(e.code).toBe("workspace.config-read-failed");
    expect(e.message).not.toContain(ROOT);
    expect(e.details).toEqual({ path: ROOT });
    expect((e as unknown as { cause: unknown }).cause).toBe(cause);
  });

  it("configWriteFailed puts the path in details", () => {
    const e = WorkspaceInfrastructureError.configWriteFailed(ROOT, cause);
    expect(e.code).toBe("workspace.config-write-failed");
    expect(e.message).not.toContain(ROOT);
    expect(e.details).toEqual({ path: ROOT });
  });

  it("directoryCreateFailed puts the path in details", () => {
    const e = WorkspaceInfrastructureError.directoryCreateFailed(ROOT, cause);
    expect(e.code).toBe("workspace.directory-create-failed");
    expect(e.message).not.toContain(ROOT);
    expect(e.details).toEqual({ path: ROOT });
  });

  it("directoryRemoveFailed puts the path in details", () => {
    const e = WorkspaceInfrastructureError.directoryRemoveFailed(ROOT, cause);
    expect(e.code).toBe("workspace.directory-remove-failed");
    expect(e.message).not.toContain(ROOT);
    expect(e.details).toEqual({ path: ROOT });
  });

  it("gitignoreUpdateFailed puts the path in details", () => {
    const e = WorkspaceInfrastructureError.gitignoreUpdateFailed(ROOT, cause);
    expect(e.code).toBe("workspace.gitignore-update-failed");
    expect(e.message).not.toContain(ROOT);
    expect(e.details).toEqual({ path: ROOT });
  });

  it("detectionFailed puts the start path in details", () => {
    const e = WorkspaceInfrastructureError.detectionFailed(ROOT, cause);
    expect(e.code).toBe("workspace.detection-failed");
    expect(e.message).not.toContain(ROOT);
    expect(e.details).toEqual({ path: ROOT });
  });

  it("unlockTargetMissing puts the path in details", () => {
    const e = WorkspaceInfrastructureError.unlockTargetMissing(ROOT);
    expect(e.code).toBe("workspace.unlock-target-missing");
    expect(e.message).not.toContain(ROOT);
    expect(e.details).toEqual({ path: ROOT });
  });

  it("details is a frozen-like read-only bag (dot-access works, no undefined-guard needed)", () => {
    const e = WorkspaceInfrastructureError.configMissing(ROOT);
    // Dot-access against `details.path` without an undefined-guard is
    // the contract: callers can read this field directly. The type
    // declares the bag as `Readonly<Record<string, unknown>>`, so we
    // verify the runtime shape via JSON round-trip.
    const json = JSON.parse(JSON.stringify(e.details)) as Record<string, unknown>;
    expect(json["path"]).toBe(ROOT);
  });
});
