/**
 * Tests for `DestroyWorkspaceUseCase` (the `recall wipe` flow).
 *
 * Covers: confirmation guard, "no workspace" rejection, lock-encryption
 * branch (encrypted + unlocked workspace), happy path, lock-no-op
 * branch, post-wipe event emission.
 */
import { describe, expect, it } from "vitest";

import { DestroyWorkspaceUseCase } from "../../../../../src/modules/workspace/application/use-cases/destroy-workspace.use-case.ts";
import { Workspace } from "../../../../../src/modules/workspace/domain/aggregates/workspace.ts";
import { WorkspaceConfig } from "../../../../../src/modules/workspace/domain/value-objects/workspace-config.ts";
import { DisplayName } from "../../../../../src/modules/workspace/domain/value-objects/display-name.ts";
import { EmbedderSpec } from "../../../../../src/modules/workspace/domain/value-objects/embedder-spec.ts";
import { WorkspaceMode } from "../../../../../src/modules/workspace/domain/value-objects/workspace-mode.ts";
import { WorkspacePath } from "../../../../../src/modules/workspace/domain/value-objects/workspace-path.ts";
import { NoWorkspaceAtPathError } from "../../../../../src/modules/workspace/application/errors/workspace-application-error.ts";
import { InvalidInputError } from "../../../../../src/shared/domain/errors/invalid-input-error.ts";
import { WorkspaceId } from "../../../../../src/shared/domain/value-objects/workspace-id.ts";
import { Timestamp } from "../../../../../src/shared/domain/value-objects/timestamp.ts";
import { FakeClock } from "../../../../../src/shared/infrastructure/clock/fake-clock.ts";

import type { DomainEvent } from "../../../../../src/shared/domain/types/domain-event.ts";
import type {
  DetectWorkspace,
  DetectWorkspaceInput,
  DetectWorkspaceOutput,
} from "../../../../../src/modules/workspace/application/ports/in/detect-workspace.port.ts";
import type {
  MemoryWipeFacade,
  MemoryWipeFacadeOutcome,
} from "../../../../../src/modules/workspace/application/ports/out/memory-wipe-facade.port.ts";
import type { EventPublisher } from "../../../../../src/shared/application/ports/event-publisher.port.ts";

import {
  FakeFilesystem,
  SilentLogger,
  StubLockEncryption,
} from "../../../../fixtures/workspace-fixtures.ts";

const FIXED_UUID = "00000000-0000-7000-8000-000000000001";
const ROOT = WorkspacePath.create("/tmp/wipe-test");

class StubDetect implements DetectWorkspace {
  public constructor(private readonly out: DetectWorkspaceOutput) {}
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public detect(_input: DetectWorkspaceInput): Promise<DetectWorkspaceOutput> {
    return Promise.resolve(this.out);
  }
}

class StubMemoryWipe implements MemoryWipeFacade {
  public calls: string[] = [];
  public outcome: MemoryWipeFacadeOutcome = { rowsDeleted: 5 };
  public wipe(input: {
    readonly workspaceId: { toString(): string };
  }): Promise<MemoryWipeFacadeOutcome> {
    this.calls.push(input.workspaceId.toString());
    return Promise.resolve(this.outcome);
  }
}

class RecordingEventPublisher implements EventPublisher {
  public events: DomainEvent[] = [];
  public publish(event: DomainEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }
  public publishAll(events: readonly DomainEvent[]): Promise<void> {
    for (const e of events) this.events.push(e);
    return Promise.resolve();
  }
}

const buildWorkspace = (
  mode: "shared" | "encrypted" | "private",
  unlocked = false,
): Workspace => {
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
};

const makeUC = (opts: {
  detectOutput: DetectWorkspaceOutput;
}): {
  uc: DestroyWorkspaceUseCase;
  fs: FakeFilesystem;
  memoryWipe: StubMemoryWipe;
  lock: StubLockEncryption;
  events: RecordingEventPublisher;
} => {
  const detect = new StubDetect(opts.detectOutput);
  const fs = new FakeFilesystem();
  const memoryWipe = new StubMemoryWipe();
  const lock = new StubLockEncryption();
  const events = new RecordingEventPublisher();
  const uc = new DestroyWorkspaceUseCase(
    detect,
    memoryWipe,
    lock,
    fs,
    events,
    new FakeClock({ initialMs: 1_700_000_000_000 }),
    new SilentLogger(),
  );
  return { uc, fs, memoryWipe, lock, events };
};

describe("DestroyWorkspaceUseCase", () => {
  it("rejects when confirmed=false", async () => {
    const { uc } = makeUC({
      detectOutput: {
        found: true,
        workspace: buildWorkspace("shared"),
        rootPath: ROOT,
      },
    });
    await expect(
      uc.destroy({ rootPath: ROOT, confirmed: false }),
    ).rejects.toThrow(InvalidInputError);
  });

  it("throws NoWorkspaceAtPathError when nothing detected", async () => {
    const { uc } = makeUC({
      detectOutput: { found: false, workspace: null, rootPath: null },
    });
    await expect(
      uc.destroy({ rootPath: ROOT, confirmed: true }),
    ).rejects.toThrow(NoWorkspaceAtPathError);
  });

  it("happy path: shared workspace — wipes SQL, removes dir, emits WorkspaceDestroyed", async () => {
    const ws = buildWorkspace("shared");
    const { uc, fs, memoryWipe, lock, events } = makeUC({
      detectOutput: { found: true, workspace: ws, rootPath: ROOT },
    });
    const out = await uc.destroy({ rootPath: ROOT, confirmed: true });
    expect(out.rowsDeleted).toBe(5);
    expect(out.removedPath).toContain(".recall");
    expect(memoryWipe.calls.length).toBe(1);
    expect(fs.removeCalls.length).toBe(1);
    expect(lock.calls.length).toBe(0); // not encrypted → no lock call
    expect(events.events.length).toBeGreaterThanOrEqual(1);
    expect(events.events[0]?.eventName).toBe("workspace.destroyed");
  });

  it("encrypted + unlocked workspace: locks first, then wipes", async () => {
    const ws = buildWorkspace("encrypted", true);
    const { uc, lock, memoryWipe } = makeUC({
      detectOutput: { found: true, workspace: ws, rootPath: ROOT },
    });
    const out = await uc.destroy({ rootPath: ROOT, confirmed: true });
    expect(lock.calls.length).toBe(1);
    expect(memoryWipe.calls.length).toBe(1);
    expect(out.rowsDeleted).toBe(5);
  });

  it("encrypted + unlocked: lock returns no-op → use case logs and continues", async () => {
    const ws = buildWorkspace("encrypted", true);
    const { uc, lock, memoryWipe } = makeUC({
      detectOutput: { found: true, workspace: ws, rootPath: ROOT },
    });
    lock.outcome = { locked: false, reason: "key-cache-already-empty" };
    const out = await uc.destroy({ rootPath: ROOT, confirmed: true });
    expect(lock.calls.length).toBe(1);
    expect(memoryWipe.calls.length).toBe(1);
    expect(out.rowsDeleted).toBe(5);
  });

  it("encrypted + locked: skips lock (workspace not unlocked)", async () => {
    // Encrypted but never unlocked → isUnlocked() === false → lock skipped.
    const ws = buildWorkspace("encrypted", false);
    const { uc, lock, memoryWipe } = makeUC({
      detectOutput: { found: true, workspace: ws, rootPath: ROOT },
    });
    await uc.destroy({ rootPath: ROOT, confirmed: true });
    expect(lock.calls.length).toBe(0);
    expect(memoryWipe.calls.length).toBe(1);
  });
});
