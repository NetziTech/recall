import { describe, it, expect } from "vitest";

import { ChangeModeUseCase } from "../../../../../src/modules/workspace/application/use-cases/change-mode.use-case.ts";
import { WorkspacePath } from "../../../../../src/modules/workspace/domain/value-objects/workspace-path.ts";
import { WorkspaceMode } from "../../../../../src/modules/workspace/domain/value-objects/workspace-mode.ts";
import { Workspace } from "../../../../../src/modules/workspace/domain/aggregates/workspace.ts";
import { WorkspaceConfig } from "../../../../../src/modules/workspace/domain/value-objects/workspace-config.ts";
import { DisplayName } from "../../../../../src/modules/workspace/domain/value-objects/display-name.ts";
import { EmbedderSpec } from "../../../../../src/modules/workspace/domain/value-objects/embedder-spec.ts";
import { WorkspaceId } from "../../../../../src/shared/domain/value-objects/workspace-id.ts";
import { Timestamp } from "../../../../../src/shared/domain/value-objects/timestamp.ts";
import { InvalidInputError } from "../../../../../src/shared/domain/errors/invalid-input-error.ts";
import { InvalidModeTransitionError } from "../../../../../src/modules/workspace/domain/errors/invalid-mode-transition-error.ts";
import { NoWorkspaceAtPathError } from "../../../../../src/modules/workspace/application/errors/workspace-application-error.ts";
import { WorkspaceLockedError } from "../../../../../src/modules/workspace/domain/errors/workspace-locked-error.ts";
import { FakeClock } from "../../../../../src/shared/infrastructure/clock/fake-clock.ts";
import type {
  DetectWorkspace,
  DetectWorkspaceInput,
  DetectWorkspaceOutput,
} from "../../../../../src/modules/workspace/application/ports/in/detect-workspace.port.ts";
import {
  FakeFilesystem,
  SilentLogger,
  StubDestroyEncryption,
  StubInitEncryption,
  StubWorkspaceProjectionWriter,
} from "../../../../fixtures/workspace-fixtures.ts";

const ROOT = WorkspacePath.create("/tmp/host");
const FIXED_UUID = "00000000-0000-7000-8000-000000000001";

class StubDetect implements DetectWorkspace {
  public constructor(private readonly out: DetectWorkspaceOutput) {}
   
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
    displayName: DisplayName.create("Project"),
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

function makeUC(opts?: {
  detectOutput?: DetectWorkspaceOutput;
}): {
  uc: ChangeModeUseCase;
  fs: FakeFilesystem;
  init: StubInitEncryption;
  destroy: StubDestroyEncryption;
  projection: StubWorkspaceProjectionWriter;
} {
  const detect: DetectWorkspace = new StubDetect(
    opts?.detectOutput ?? {
      found: true,
      workspace: buildWorkspace("shared"),
      rootPath: ROOT,
    },
  );
  const fs = new FakeFilesystem();
  const init = new StubInitEncryption();
  const destroy = new StubDestroyEncryption();
  const projection = new StubWorkspaceProjectionWriter();
  const uc = new ChangeModeUseCase(
    detect,
    fs,
    init,
    destroy,
    projection,
    new FakeClock({ initialMs: 1000 }),
    new SilentLogger(),
  );
  return { uc, fs, init, destroy, projection };
}

describe("ChangeModeUseCase — preconditions", () => {
  it("throws when no workspace is detected", async () => {
    const { uc } = makeUC({
      detectOutput: { found: false, workspace: null, rootPath: null },
    });
    await expect(
      uc.change({
        rootPath: ROOT,
        newMode: WorkspaceMode.privateMode(),
        passphrase: null,
      }),
    ).rejects.toBeInstanceOf(NoWorkspaceAtPathError);
  });

  it("encrypted source must be unlocked first", async () => {
    const ws = buildWorkspace("encrypted", false);
    const { uc } = makeUC({
      detectOutput: { found: true, workspace: ws, rootPath: ROOT },
    });
    await expect(
      uc.change({
        rootPath: ROOT,
        newMode: WorkspaceMode.privateMode(),
        passphrase: "p",
      }),
    ).rejects.toBeInstanceOf(WorkspaceLockedError);
  });
});

describe("ChangeModeUseCase — transitions into encrypted", () => {
  it("requires non-empty passphrase", async () => {
    const ws = buildWorkspace("shared");
    const { uc } = makeUC({
      detectOutput: { found: true, workspace: ws, rootPath: ROOT },
    });
    await expect(
      uc.change({
        rootPath: ROOT,
        newMode: WorkspaceMode.encryptedMode(),
        passphrase: null,
      }),
    ).rejects.toBeInstanceOf(InvalidInputError);
  });

  it("calls init encryption + writes config + ensures gitignore + projects identity row", async () => {
    const ws = buildWorkspace("shared");
    const { uc, fs, init, projection } = makeUC({
      detectOutput: { found: true, workspace: ws, rootPath: ROOT },
    });
    const out = await uc.change({
      rootPath: ROOT,
      newMode: WorkspaceMode.encryptedMode(),
      passphrase: "secret",
    });
    expect(out.workspace.getMode().toString()).toBe("encrypted");
    expect(init.calls.length).toBe(1);
    expect(init.calls[0]?.passphrase).toBe("secret");
    expect(fs.writeCalls.length).toBe(1);
    expect(fs.gitignoreCalls.length).toBe(1);
    // Identity row reprojected so the SQL anchor matches the new mode
    // (Tarea 5.3 — Bug 1 fix).
    expect(projection.calls.length).toBe(1);
    expect(projection.calls[0]?.config.mode.toString()).toBe("encrypted");
  });
});

describe("ChangeModeUseCase — transitions out of encrypted", () => {
  it("encrypted -> private requires passphrase", async () => {
    const ws = buildWorkspace("encrypted", true);
    const { uc } = makeUC({
      detectOutput: { found: true, workspace: ws, rootPath: ROOT },
    });
    await expect(
      uc.change({
        rootPath: ROOT,
        newMode: WorkspaceMode.privateMode(),
        passphrase: null,
      }),
    ).rejects.toBeInstanceOf(InvalidInputError);
  });

  it("encrypted -> private calls destroy facade", async () => {
    const ws = buildWorkspace("encrypted", true);
    const { uc, destroy } = makeUC({
      detectOutput: { found: true, workspace: ws, rootPath: ROOT },
    });
    const out = await uc.change({
      rootPath: ROOT,
      newMode: WorkspaceMode.privateMode(),
      passphrase: "p",
    });
    expect(destroy.calls.length).toBe(1);
    expect(destroy.calls[0]?.targetMode).toBe("private");
    expect(out.workspace.getMode().toString()).toBe("private");
  });

  it("encrypted -> shared is rejected at the aggregate level", async () => {
    const ws = buildWorkspace("encrypted", true);
    const { uc } = makeUC({
      detectOutput: { found: true, workspace: ws, rootPath: ROOT },
    });
    await expect(
      uc.change({
        rootPath: ROOT,
        newMode: WorkspaceMode.sharedMode(),
        passphrase: "p",
      }),
    ).rejects.toBeInstanceOf(InvalidModeTransitionError);
  });
});

describe("ChangeModeUseCase — non-crypto transitions", () => {
  it("shared -> private writes config + gitignore (no facades)", async () => {
    const ws = buildWorkspace("shared");
    const { uc, fs, init, destroy } = makeUC({
      detectOutput: { found: true, workspace: ws, rootPath: ROOT },
    });
    const out = await uc.change({
      rootPath: ROOT,
      newMode: WorkspaceMode.privateMode(),
      passphrase: null,
    });
    expect(out.workspace.getMode().toString()).toBe("private");
    expect(init.calls.length).toBe(0);
    expect(destroy.calls.length).toBe(0);
    expect(fs.writeCalls.length).toBe(1);
    expect(fs.gitignoreCalls.length).toBe(1);
    expect(fs.gitignoreCalls[0]?.mode.toString()).toBe("private");
  });

  it("private -> shared", async () => {
    const ws = buildWorkspace("private");
    const { uc, fs } = makeUC({
      detectOutput: { found: true, workspace: ws, rootPath: ROOT },
    });
    const out = await uc.change({
      rootPath: ROOT,
      newMode: WorkspaceMode.sharedMode(),
      passphrase: null,
    });
    expect(out.workspace.getMode().toString()).toBe("shared");
    expect(fs.gitignoreCalls[0]?.mode.toString()).toBe("shared");
  });
});
