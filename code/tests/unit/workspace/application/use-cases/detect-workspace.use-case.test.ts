import { describe, it, expect } from "vitest";

import { DetectWorkspaceUseCase } from "../../../../../src/modules/workspace/application/use-cases/detect-workspace.use-case.ts";
import { WorkspacePath } from "../../../../../src/modules/workspace/domain/value-objects/workspace-path.ts";
import {
  FakeFilesystem,
  SilentLogger,
  StubDetector,
} from "../../../../fixtures/workspace-fixtures.ts";

const ROOT = WorkspacePath.create("/tmp/host");
const FIXED_UUID = "00000000-0000-7000-8000-000000000001";

describe("DetectWorkspaceUseCase", () => {
  it("returns found=false when detector reports no hit", async () => {
    const detector = new StubDetector({ exists: false, configPath: null });
    const fs = new FakeFilesystem();
    const uc = new DetectWorkspaceUseCase(detector, fs, new SilentLogger());
    const out = await uc.detect({ startPath: ROOT });
    expect(out).toEqual({ found: false, workspace: null, rootPath: null });
  });

  it("returns the rehydrated workspace on hit", async () => {
    const configPath = WorkspacePath.create("/tmp/host");
    const detector = new StubDetector({ exists: true, configPath });
    const fs = new FakeFilesystem();
    fs.readAnswer = {
      schemaVersion: "1.0.0",
      workspaceId: FIXED_UUID,
      displayName: "Test",
      mode: "encrypted",
      createdAtMs: 1_700_000_000_000,
      embedder: { provider: "fastembed", model: "BGESmallEN15", dim: 384 },
    };
    const uc = new DetectWorkspaceUseCase(detector, fs, new SilentLogger());
    const out = await uc.detect({ startPath: ROOT });
    expect(out.found).toBe(true);
    if (out.found) {
      expect(out.workspace.getId().toString()).toBe(FIXED_UUID);
      expect(out.workspace.getMode().toString()).toBe("encrypted");
      expect(out.rootPath.equals(configPath)).toBe(true);
    }
  });

  it("propagates filesystem readConfig errors", async () => {
    const configPath = WorkspacePath.create("/tmp/host");
    const detector = new StubDetector({ exists: true, configPath });
    const fs = new FakeFilesystem();
    fs.readThrows = new Error("malformed");
    const uc = new DetectWorkspaceUseCase(detector, fs, new SilentLogger());
    await expect(uc.detect({ startPath: ROOT })).rejects.toThrow("malformed");
  });
});
