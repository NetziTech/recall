import { describe, it, expect } from "vitest";

import { LockWorkspaceUseCase } from "../../../../../src/modules/workspace/application/use-cases/lock-workspace.use-case.ts";
import { DetectWorkspaceUseCase } from "../../../../../src/modules/workspace/application/use-cases/detect-workspace.use-case.ts";
import { WorkspacePath } from "../../../../../src/modules/workspace/domain/value-objects/workspace-path.ts";
import { NoWorkspaceAtPathError } from "../../../../../src/modules/workspace/application/errors/workspace-application-error.ts";
import { Workspace } from "../../../../../src/modules/workspace/domain/aggregates/workspace.ts";
import { WorkspaceConfig } from "../../../../../src/modules/workspace/domain/value-objects/workspace-config.ts";
import { WorkspaceMode } from "../../../../../src/modules/workspace/domain/value-objects/workspace-mode.ts";
import { DisplayName } from "../../../../../src/modules/workspace/domain/value-objects/display-name.ts";
import { EmbedderSpec } from "../../../../../src/modules/workspace/domain/value-objects/embedder-spec.ts";
import { WorkspaceId } from "../../../../../src/shared/domain/value-objects/workspace-id.ts";
import { Timestamp } from "../../../../../src/shared/domain/value-objects/timestamp.ts";
import { FakeClock } from "../../../../../src/shared/infrastructure/clock/fake-clock.ts";
import type {
  DetectWorkspace,
  DetectWorkspaceInput,
  DetectWorkspaceOutput,
} from "../../../../../src/modules/workspace/application/ports/in/detect-workspace.port.ts";
import {
  FakeFilesystem,
  SilentLogger,
  StubDetector,
  StubLockEncryption,
} from "../../../../fixtures/workspace-fixtures.ts";

const ROOT = WorkspacePath.create("/tmp/host");
const FIXED_UUID = "00000000-0000-7000-8000-000000000001";

class StubDetect implements DetectWorkspace {
  public constructor(private readonly out: DetectWorkspaceOutput) {}
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public detect(_input: DetectWorkspaceInput): Promise<DetectWorkspaceOutput> {
    return Promise.resolve(this.out);
  }
}

function buildWorkspace(
  mode: "shared" | "encrypted" | "private",
  unlocked = false,
): Workspace {
  const cfg = WorkspaceConfig.create({
    schemaVersion: "1.0.0",
    workspaceId: WorkspaceId.from(FIXED_UUID),
    displayName: DisplayName.create("T"),
    mode: WorkspaceMode.create(mode),
    embedder: EmbedderSpec.create({ provider: "fastembed", model: "BGESmallEN15" }),
    createdAt: Timestamp.fromEpochMs(0),
  });
  const ws = Workspace.rehydrate(cfg);
  if (mode === "encrypted" && unlocked) {
    ws.unlock({ occurredAt: Timestamp.fromEpochMs(0) });
    ws.pullEvents();
  }
  return ws;
}

describe("LockWorkspaceUseCase", () => {
  it("throws when no workspace is detected", async () => {
    const detector = new StubDetector({ exists: false, configPath: null });
    const fs = new FakeFilesystem();
    const detect = new DetectWorkspaceUseCase(detector, fs, new SilentLogger());
    const uc = new LockWorkspaceUseCase(
      detect,
      new StubLockEncryption(),
      new FakeClock({ initialMs: 0 }),
      new SilentLogger(),
    );
    await expect(uc.lock({ rootPath: ROOT })).rejects.toBeInstanceOf(
      NoWorkspaceAtPathError,
    );
  });

  it("non-encrypted → no-op", async () => {
    const ws = buildWorkspace("shared");
    const detect = new StubDetect({ found: true, workspace: ws, rootPath: ROOT });
    const facade = new StubLockEncryption();
    const uc = new LockWorkspaceUseCase(
      detect,
      facade,
      new FakeClock({ initialMs: 0 }),
      new SilentLogger(),
    );
    const out = await uc.lock({ rootPath: ROOT });
    expect(out.wasLocked).toBe(false);
    expect(facade.calls.length).toBe(0);
  });

  it("encrypted + locked → no-op", async () => {
    const ws = buildWorkspace("encrypted", false);
    const detect = new StubDetect({ found: true, workspace: ws, rootPath: ROOT });
    const facade = new StubLockEncryption();
    const uc = new LockWorkspaceUseCase(
      detect,
      facade,
      new FakeClock({ initialMs: 0 }),
      new SilentLogger(),
    );
    const out = await uc.lock({ rootPath: ROOT });
    expect(out.wasLocked).toBe(false);
  });

  it("encrypted + unlocked → calls facade and locks aggregate", async () => {
    const ws = buildWorkspace("encrypted", true);
    const detect = new StubDetect({ found: true, workspace: ws, rootPath: ROOT });
    const facade = new StubLockEncryption();
    facade.outcome = { locked: true };
    const uc = new LockWorkspaceUseCase(
      detect,
      facade,
      new FakeClock({ initialMs: 1234 }),
      new SilentLogger(),
    );
    const out = await uc.lock({ rootPath: ROOT });
    expect(out.wasLocked).toBe(true);
    expect(out.workspace.isUnlocked()).toBe(false);
    expect(facade.calls).toEqual([FIXED_UUID]);
  });

  it("encrypted + facade reports already-locked → no-op + warn", async () => {
    const ws = buildWorkspace("encrypted", true);
    const detect = new StubDetect({ found: true, workspace: ws, rootPath: ROOT });
    const facade = new StubLockEncryption();
    facade.outcome = { locked: false, reason: "already-locked" };
    const uc = new LockWorkspaceUseCase(
      detect,
      facade,
      new FakeClock({ initialMs: 0 }),
      new SilentLogger(),
    );
    const out = await uc.lock({ rootPath: ROOT });
    expect(out.wasLocked).toBe(false);
  });
});
