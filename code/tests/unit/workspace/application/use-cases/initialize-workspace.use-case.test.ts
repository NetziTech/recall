import { describe, it, expect } from "vitest";

import { InitializeWorkspaceUseCase } from "../../../../../src/modules/workspace/application/use-cases/initialize-workspace.use-case.ts";
import { DisplayName } from "../../../../../src/modules/workspace/domain/value-objects/display-name.ts";
import { EmbedderSpec } from "../../../../../src/modules/workspace/domain/value-objects/embedder-spec.ts";
import { WorkspaceMode } from "../../../../../src/modules/workspace/domain/value-objects/workspace-mode.ts";
import { WorkspacePath } from "../../../../../src/modules/workspace/domain/value-objects/workspace-path.ts";
import { WorkspaceAlreadyInitializedError } from "../../../../../src/modules/workspace/domain/errors/workspace-already-initialized-error.ts";
import { InvalidInputError } from "../../../../../src/shared/domain/errors/invalid-input-error.ts";
import { FakeClock } from "../../../../../src/shared/infrastructure/clock/fake-clock.ts";
import { FakeIdGenerator } from "../../../../../src/shared/infrastructure/id-generator/fake-id-generator.ts";
import {
  FakeFilesystem,
  SilentLogger,
  StubDatabaseBootstrap,
  StubInitEncryption,
  StubWorkspaceProjectionWriter,
} from "../../../../fixtures/workspace-fixtures.ts";

const ROOT = WorkspacePath.create("/tmp/host-project");
const FIXED_UUID = "00000000-0000-7000-8000-000000000001";

function makeUseCase(opts?: {
  readonly fs?: FakeFilesystem;
  readonly db?: StubDatabaseBootstrap;
  readonly enc?: StubInitEncryption;
  readonly projection?: StubWorkspaceProjectionWriter;
}): {
  uc: InitializeWorkspaceUseCase;
  fs: FakeFilesystem;
  db: StubDatabaseBootstrap;
  enc: StubInitEncryption;
  projection: StubWorkspaceProjectionWriter;
} {
  const fs = opts?.fs ?? new FakeFilesystem();
  const db = opts?.db ?? new StubDatabaseBootstrap();
  const enc = opts?.enc ?? new StubInitEncryption();
  const projection = opts?.projection ?? new StubWorkspaceProjectionWriter();
  const clock = new FakeClock({ initialMs: 1_700_000_000_000 });
  const idGen = new FakeIdGenerator();
  return {
    uc: new InitializeWorkspaceUseCase(
      fs,
      db,
      enc,
      projection,
      idGen,
      clock,
      new SilentLogger(),
    ),
    fs,
    db,
    enc,
    projection,
  };
}

describe("InitializeWorkspaceUseCase — fresh init", () => {
  it("creates dir, writes config, bootstraps DB, ensures gitignore (shared)", async () => {
    const { uc, fs, db, enc, projection } = makeUseCase();
    fs.existsAnswer = false;
    const out = await uc.initialize({
      rootPath: ROOT,
      mode: WorkspaceMode.sharedMode(),
      displayName: DisplayName.create("Test"),
      embedder: EmbedderSpec.create({ provider: "fastembed", model: "BGESmallEN15" }),
      passphrase: null,
    });
    expect(out.wasCreated).toBe(true);
    expect(out.workspace.getMode().toString()).toBe("shared");
    expect(out.workspace.getId().toString()).toBe(FIXED_UUID);

    expect(fs.createCalls.length).toBe(1);
    expect(fs.writeCalls.length).toBe(1);
    expect(fs.gitignoreCalls.length).toBe(1);
    expect(db.bootstrapCalls.length).toBe(1);
    expect(enc.calls.length).toBe(0);
    // The workspace identity row was projected into the SQL anchor
    // table (Tarea 5.3 — Bug 1 fix).
    expect(projection.calls.length).toBe(1);
    expect(projection.calls[0]?.config.workspaceId.toString()).toBe(FIXED_UUID);

    // The workspace aggregate emitted WorkspaceInitialized.
    const events = out.workspace.pullEvents();
    expect(events.length).toBe(1);
    expect(events[0]?.eventName).toBe("workspace.initialized");
  });

  it("encrypted mode: requires non-empty passphrase, calls encryption facade", async () => {
    const { enc } = makeUseCase();
    const fs = new FakeFilesystem();
    fs.existsAnswer = false;
    const u2 = makeUseCase({ fs, enc });
    const result = await u2.uc.initialize({
      rootPath: ROOT,
      mode: WorkspaceMode.encryptedMode(),
      displayName: DisplayName.create("Test"),
      embedder: EmbedderSpec.create({ provider: "fastembed", model: "BGESmallEN15" }),
      passphrase: "correct horse",
    });
    expect(result.wasCreated).toBe(true);
    expect(enc.calls.length).toBe(1);
    expect(enc.calls[0]?.passphrase).toBe("correct horse");
  });

  it("encrypted mode + null passphrase → InvalidInputError", async () => {
    const { uc } = makeUseCase();
    const fs = new FakeFilesystem();
    fs.existsAnswer = false;
    const u2 = makeUseCase({ fs });
    await expect(
      u2.uc.initialize({
        rootPath: ROOT,
        mode: WorkspaceMode.encryptedMode(),
        displayName: DisplayName.create("Test"),
        embedder: EmbedderSpec.create({ provider: "fastembed", model: "BGESmallEN15" }),
        passphrase: null,
      }),
    ).rejects.toBeInstanceOf(InvalidInputError);
    void uc;
  });

  it("encrypted mode + empty passphrase → InvalidInputError", async () => {
    const fs = new FakeFilesystem();
    fs.existsAnswer = false;
    const u2 = makeUseCase({ fs });
    await expect(
      u2.uc.initialize({
        rootPath: ROOT,
        mode: WorkspaceMode.encryptedMode(),
        displayName: DisplayName.create("Test"),
        embedder: EmbedderSpec.create({ provider: "fastembed", model: "BGESmallEN15" }),
        passphrase: "",
      }),
    ).rejects.toBeInstanceOf(InvalidInputError);
  });
});

describe("InitializeWorkspaceUseCase — rehydrate path", () => {
  it("returns wasCreated=false when workspace already exists in same mode", async () => {
    const fs = new FakeFilesystem();
    fs.existsAnswer = true;
    fs.readAnswer = {
      schemaVersion: "1.0.0",
      workspaceId: FIXED_UUID,
      displayName: "Existing",
      mode: "shared",
      createdAtMs: 1_690_000_000_000,
      embedder: { provider: "fastembed", model: "BGESmallEN15", dim: 384 },
    };
    const { uc, db, projection } = makeUseCase({ fs });
    const out = await uc.initialize({
      rootPath: ROOT,
      mode: WorkspaceMode.sharedMode(),
      displayName: DisplayName.create("New"),
      embedder: EmbedderSpec.create({ provider: "fastembed", model: "BGESmallEN15" }),
      passphrase: null,
    });
    expect(out.wasCreated).toBe(false);
    expect(out.workspace.getMode().toString()).toBe("shared");
    // Did NOT call createWorkspaceDirectory or writeConfig.
    expect(fs.createCalls.length).toBe(0);
    expect(fs.writeCalls.length).toBe(0);
    // BUT the rehydrate path re-bootstraps (idempotent migrations) and
    // re-projects the identity row so workspaces created before
    // migration 006 acquire the new `workspace_config` row on the next
    // `mem.init` (Tarea 5.3 — Bug 1 fix).
    expect(db.bootstrapCalls.length).toBe(1);
    expect(projection.calls.length).toBe(1);
  });

  it("rejects when the existing workspace's mode differs", async () => {
    const fs = new FakeFilesystem();
    fs.existsAnswer = true;
    fs.readAnswer = {
      schemaVersion: "1.0.0",
      workspaceId: FIXED_UUID,
      displayName: "Existing",
      mode: "private",
      createdAtMs: 0,
      embedder: { provider: "fastembed", model: "BGESmallEN15", dim: 384 },
    };
    const { uc } = makeUseCase({ fs });
    await expect(
      uc.initialize({
        rootPath: ROOT,
        mode: WorkspaceMode.sharedMode(),
        displayName: DisplayName.create("X"),
        embedder: EmbedderSpec.create({ provider: "fastembed", model: "BGESmallEN15" }),
        passphrase: null,
      }),
    ).rejects.toBeInstanceOf(WorkspaceAlreadyInitializedError);
  });
});
