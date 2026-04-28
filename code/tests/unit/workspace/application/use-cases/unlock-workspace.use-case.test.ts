import { describe, it, expect } from "vitest";

import { UnlockWorkspaceUseCase } from "../../../../../src/modules/workspace/application/use-cases/unlock-workspace.use-case.ts";
import { DetectWorkspaceUseCase } from "../../../../../src/modules/workspace/application/use-cases/detect-workspace.use-case.ts";
import { WorkspacePath } from "../../../../../src/modules/workspace/domain/value-objects/workspace-path.ts";
import { NoWorkspaceAtPathError } from "../../../../../src/modules/workspace/application/errors/workspace-application-error.ts";
import { WorkspaceLockedError } from "../../../../../src/modules/workspace/domain/errors/workspace-locked-error.ts";
import { Workspace } from "../../../../../src/modules/workspace/domain/aggregates/workspace.ts";
import { WorkspaceConfig } from "../../../../../src/modules/workspace/domain/value-objects/workspace-config.ts";
import { WorkspaceMode } from "../../../../../src/modules/workspace/domain/value-objects/workspace-mode.ts";
import { DisplayName } from "../../../../../src/modules/workspace/domain/value-objects/display-name.ts";
import { EmbedderSpec } from "../../../../../src/modules/workspace/domain/value-objects/embedder-spec.ts";
import { WorkspaceId } from "../../../../../src/shared/domain/value-objects/workspace-id.ts";
import { Timestamp } from "../../../../../src/shared/domain/value-objects/timestamp.ts";
import type {
  DetectWorkspace,
  DetectWorkspaceInput,
  DetectWorkspaceOutput,
} from "../../../../../src/modules/workspace/application/ports/in/detect-workspace.port.ts";
import { FakeClock } from "../../../../../src/shared/infrastructure/clock/fake-clock.ts";
import {
  FakeFilesystem,
  SilentLogger,
  StubDetector,
  StubUnlockEncryption,
} from "../../../../fixtures/workspace-fixtures.ts";

class StubDetect implements DetectWorkspace {
  public constructor(private readonly output: DetectWorkspaceOutput) {}
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public detect(_input: DetectWorkspaceInput): Promise<DetectWorkspaceOutput> {
    return Promise.resolve(this.output);
  }
}

function buildEncryptedWorkspace(unlocked: boolean): Workspace {
  const cfg = WorkspaceConfig.create({
    schemaVersion: "1.0.0",
    workspaceId: WorkspaceId.from(FIXED_UUID),
    displayName: DisplayName.create("T"),
    mode: WorkspaceMode.encryptedMode(),
    embedder: EmbedderSpec.create({ provider: "fastembed", model: "BGESmallEN15" }),
    createdAt: Timestamp.fromEpochMs(0),
  });
  const ws = Workspace.rehydrate(cfg);
  if (unlocked) ws.unlock({ occurredAt: Timestamp.fromEpochMs(0) });
  return ws;
}

const ROOT = WorkspacePath.create("/tmp/host");
const FIXED_UUID = "00000000-0000-7000-8000-000000000001";

function buildDetect(mode: "shared" | "encrypted" | "private"): {
  detect: DetectWorkspaceUseCase;
  fs: FakeFilesystem;
  detector: StubDetector;
} {
  const detector = new StubDetector({
    exists: true,
    configPath: ROOT,
  });
  const fs = new FakeFilesystem();
  fs.readAnswer = {
    schemaVersion: "1.0.0",
    workspaceId: FIXED_UUID,
    displayName: "T",
    mode,
    createdAtMs: 0,
    embedder: { provider: "fastembed", model: "BGESmallEN15", dim: 384 },
  };
  const detect = new DetectWorkspaceUseCase(detector, fs, new SilentLogger());
  return { detect, fs, detector };
}

describe("UnlockWorkspaceUseCase", () => {
  it("throws NoWorkspaceAtPathError when detector reports nothing", async () => {
    const detector = new StubDetector({ exists: false, configPath: null });
    const fs = new FakeFilesystem();
    const detect = new DetectWorkspaceUseCase(detector, fs, new SilentLogger());
    const uc = new UnlockWorkspaceUseCase(
      detect,
      new StubUnlockEncryption(),
      new FakeClock({ initialMs: 0 }),
      new SilentLogger(),
    );
    await expect(
      uc.unlock({ rootPath: ROOT, passphrase: "p" }),
    ).rejects.toBeInstanceOf(NoWorkspaceAtPathError);
  });

  it("non-encrypted workspace → no-op success", async () => {
    const { detect } = buildDetect("shared");
    const facade = new StubUnlockEncryption();
    const uc = new UnlockWorkspaceUseCase(
      detect,
      facade,
      new FakeClock({ initialMs: 0 }),
      new SilentLogger(),
    );
    const out = await uc.unlock({ rootPath: ROOT, passphrase: null });
    expect(out.wasUnlocked).toBe(false);
    expect(facade.calls.length).toBe(0);
  });

  it("already-unlocked encrypted workspace → no-op", async () => {
    const ws = buildEncryptedWorkspace(true);
    ws.pullEvents();
    const detect = new StubDetect({
      found: true,
      workspace: ws,
      rootPath: ROOT,
    });
    const facade = new StubUnlockEncryption();
    const uc = new UnlockWorkspaceUseCase(
      detect,
      facade,
      new FakeClock({ initialMs: 0 }),
      new SilentLogger(),
    );
    const out = await uc.unlock({ rootPath: ROOT, passphrase: "p" });
    expect(out.wasUnlocked).toBe(false);
    expect(facade.calls.length).toBe(0); // no facade call
  });

  it("encrypted + correct passphrase → workspace unlocked", async () => {
    const { detect } = buildDetect("encrypted");
    const facade = new StubUnlockEncryption();
    facade.outcome = { unlocked: true };
    const clock = new FakeClock({ initialMs: 1000 });
    const uc = new UnlockWorkspaceUseCase(detect, facade, clock, new SilentLogger());
    const out = await uc.unlock({ rootPath: ROOT, passphrase: "open" });
    expect(out.wasUnlocked).toBe(true);
    expect(out.workspace.isUnlocked()).toBe(true);
    expect(facade.calls.length).toBe(1);
    expect(facade.calls[0]?.passphrase).toBe("open");
  });

  it("encrypted + key-validation-failed → WorkspaceLockedError", async () => {
    const { detect } = buildDetect("encrypted");
    const facade = new StubUnlockEncryption();
    facade.outcome = {
      unlocked: false,
      reason: "key-validation-failed",
    };
    const uc = new UnlockWorkspaceUseCase(
      detect,
      facade,
      new FakeClock({ initialMs: 0 }),
      new SilentLogger(),
    );
    await expect(
      uc.unlock({ rootPath: ROOT, passphrase: "wrong" }),
    ).rejects.toBeInstanceOf(WorkspaceLockedError);
  });

  it("encrypted + facade reports not-encrypted → no-op + warn", async () => {
    const { detect } = buildDetect("encrypted");
    const facade = new StubUnlockEncryption();
    facade.outcome = { unlocked: false, reason: "not-encrypted" };
    const uc = new UnlockWorkspaceUseCase(
      detect,
      facade,
      new FakeClock({ initialMs: 0 }),
      new SilentLogger(),
    );
    const out = await uc.unlock({ rootPath: ROOT, passphrase: "p" });
    expect(out.wasUnlocked).toBe(false);
    expect(out.workspace.isUnlocked()).toBe(false);
  });
});
