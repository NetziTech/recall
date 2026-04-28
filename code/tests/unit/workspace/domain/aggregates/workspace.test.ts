import { describe, it, expect } from "vitest";

import { Workspace } from "../../../../../src/modules/workspace/domain/aggregates/workspace.ts";
import { DisplayName } from "../../../../../src/modules/workspace/domain/value-objects/display-name.ts";
import { EmbedderSpec } from "../../../../../src/modules/workspace/domain/value-objects/embedder-spec.ts";
import { WorkspaceConfig } from "../../../../../src/modules/workspace/domain/value-objects/workspace-config.ts";
import { WorkspaceMode } from "../../../../../src/modules/workspace/domain/value-objects/workspace-mode.ts";
import { WorkspaceId } from "../../../../../src/shared/domain/value-objects/workspace-id.ts";
import { Timestamp } from "../../../../../src/shared/domain/value-objects/timestamp.ts";
import { InvalidModeTransitionError } from "../../../../../src/modules/workspace/domain/errors/invalid-mode-transition-error.ts";
import { WorkspaceAlreadyInitializedError } from "../../../../../src/modules/workspace/domain/errors/workspace-already-initialized-error.ts";
import { WorkspaceLockedError } from "../../../../../src/modules/workspace/domain/errors/workspace-locked-error.ts";
import { InvariantViolationError } from "../../../../../src/shared/domain/errors/invariant-violation-error.ts";
import { WorkspaceInitialized } from "../../../../../src/modules/workspace/domain/events/workspace-initialized.ts";
import { WorkspaceLocked } from "../../../../../src/modules/workspace/domain/events/workspace-locked.ts";
import { WorkspaceUnlocked } from "../../../../../src/modules/workspace/domain/events/workspace-unlocked.ts";
import { WorkspaceModeChanged } from "../../../../../src/modules/workspace/domain/events/workspace-mode-changed.ts";

const W_ID = "01952f3b-7d8c-7b4a-94f1-a3f8d12e5c89";

function makeConfig(mode: "shared" | "encrypted" | "private" = "shared"): WorkspaceConfig {
  return WorkspaceConfig.create({
    schemaVersion: "1.0.0",
    workspaceId: WorkspaceId.from(W_ID),
    displayName: DisplayName.create("Test"),
    mode: WorkspaceMode.create(mode),
    embedder: EmbedderSpec.create({ provider: "fastembed", model: "BGESmallEN15" }),
    createdAt: Timestamp.fromEpochMs(0),
  });
}

const NOW = Timestamp.fromEpochMs(1_700_000_000_000);

describe("Workspace.initialize", () => {
  it("emits WorkspaceInitialized exactly once", () => {
    const ws = Workspace.initialize({ config: makeConfig(), occurredAt: NOW });
    const events = ws.pullEvents();
    expect(events.length).toBe(1);
    expect(events[0]).toBeInstanceOf(WorkspaceInitialized);
    expect((events[0] as WorkspaceInitialized).workspaceId.toString()).toBe(
      W_ID,
    );
  });

  it("starts unlocked=false", () => {
    const ws = Workspace.initialize({ config: makeConfig(), occurredAt: NOW });
    expect(ws.isUnlocked()).toBe(false);
  });

  it("identity stable", () => {
    const ws = Workspace.initialize({ config: makeConfig(), occurredAt: NOW });
    expect(ws.getId().toString()).toBe(W_ID);
    expect(ws.getMode().toString()).toBe("shared");
    expect(ws.getConfig().workspaceId.equals(ws.getId())).toBe(true);
  });

  it("pullEvents drains the buffer; second call returns empty", () => {
    const ws = Workspace.initialize({ config: makeConfig(), occurredAt: NOW });
    expect(ws.pullEvents().length).toBe(1);
    expect(ws.pullEvents().length).toBe(0);
  });
});

describe("Workspace.rehydrate", () => {
  it("does NOT emit any event", () => {
    const ws = Workspace.rehydrate(makeConfig());
    expect(ws.pullEvents().length).toBe(0);
  });

  it("starts locked", () => {
    const ws = Workspace.rehydrate(makeConfig("encrypted"));
    expect(ws.isUnlocked()).toBe(false);
    expect(ws.isLocked()).toBe(true);
  });
});

describe("Workspace.changeMode", () => {
  it("rejects no-op transitions", () => {
    const ws = Workspace.rehydrate(makeConfig("shared"));
    expect(() =>
      ws.changeMode({
        newMode: WorkspaceMode.sharedMode(),
        occurredAt: NOW,
      }),
    ).toThrow(InvariantViolationError);
  });

  it.each([
    ["shared", "encrypted"],
    ["shared", "private"],
    ["encrypted", "private"],
    ["private", "shared"],
    ["private", "encrypted"],
  ] as const)("allows %s -> %s", (from, to) => {
    const ws = Workspace.rehydrate(makeConfig(from));
    ws.changeMode({ newMode: WorkspaceMode.create(to), occurredAt: NOW });
    expect(ws.getMode().toString()).toBe(to);
    const events = ws.pullEvents();
    expect(events.length).toBe(1);
    expect(events[0]).toBeInstanceOf(WorkspaceModeChanged);
  });

  it("rejects encrypted -> shared (must go through private first)", () => {
    const ws = Workspace.rehydrate(makeConfig("encrypted"));
    expect(() =>
      ws.changeMode({
        newMode: WorkspaceMode.sharedMode(),
        occurredAt: NOW,
      }),
    ).toThrow(InvalidModeTransitionError);
  });

  it("clears unlocked flag when leaving encrypted", () => {
    const ws = Workspace.rehydrate(makeConfig("encrypted"));
    ws.unlock({ occurredAt: NOW });
    expect(ws.isUnlocked()).toBe(true);
    ws.changeMode({ newMode: WorkspaceMode.privateMode(), occurredAt: NOW });
    expect(ws.isUnlocked()).toBe(false);
  });

  it("emits WorkspaceModeChanged with previous + new mode", () => {
    const ws = Workspace.rehydrate(makeConfig("shared"));
    ws.changeMode({
      newMode: WorkspaceMode.privateMode(),
      occurredAt: NOW,
    });
    const events = ws.pullEvents();
    const e = events[0] as WorkspaceModeChanged;
    expect(e.previousMode.toString()).toBe("shared");
    expect(e.newMode.toString()).toBe("private");
  });
});

describe("Workspace.unlock / Workspace.lock", () => {
  it("unlock works only on encrypted mode", () => {
    const ws = Workspace.rehydrate(makeConfig("shared"));
    expect(() => ws.unlock({ occurredAt: NOW })).toThrow(InvariantViolationError);

    const wsP = Workspace.rehydrate(makeConfig("private"));
    expect(() => wsP.unlock({ occurredAt: NOW })).toThrow(InvariantViolationError);
  });

  it("unlock + emit WorkspaceUnlocked", () => {
    const ws = Workspace.rehydrate(makeConfig("encrypted"));
    ws.unlock({ occurredAt: NOW });
    expect(ws.isUnlocked()).toBe(true);
    const events = ws.pullEvents();
    expect(events.length).toBe(1);
    expect(events[0]).toBeInstanceOf(WorkspaceUnlocked);
  });

  it("unlock rejects already-unlocked workspace", () => {
    const ws = Workspace.rehydrate(makeConfig("encrypted"));
    ws.unlock({ occurredAt: NOW });
    expect(() => ws.unlock({ occurredAt: NOW })).toThrow(InvariantViolationError);
  });

  it("lock works only on encrypted mode", () => {
    const ws = Workspace.rehydrate(makeConfig("shared"));
    expect(() => ws.lock({ occurredAt: NOW })).toThrow(InvariantViolationError);
  });

  it("lock rejects already-locked workspace", () => {
    const ws = Workspace.rehydrate(makeConfig("encrypted"));
    expect(() => ws.lock({ occurredAt: NOW })).toThrow(InvariantViolationError);
  });

  it("lock + emit WorkspaceLocked", () => {
    const ws = Workspace.rehydrate(makeConfig("encrypted"));
    ws.unlock({ occurredAt: NOW });
    ws.pullEvents(); // drain unlock
    ws.lock({ occurredAt: NOW });
    expect(ws.isUnlocked()).toBe(false);
    const events = ws.pullEvents();
    expect(events.length).toBe(1);
    expect(events[0]).toBeInstanceOf(WorkspaceLocked);
  });
});

describe("Workspace.assertReadyForUse", () => {
  it("encrypted + locked → throws WorkspaceLockedError", () => {
    const ws = Workspace.rehydrate(makeConfig("encrypted"));
    expect(() => ws.assertReadyForUse()).toThrow(WorkspaceLockedError);
  });

  it("encrypted + unlocked → no throw", () => {
    const ws = Workspace.rehydrate(makeConfig("encrypted"));
    ws.unlock({ occurredAt: NOW });
    expect(() => ws.assertReadyForUse()).not.toThrow();
  });

  it("non-encrypted modes → never throws", () => {
    const ws = Workspace.rehydrate(makeConfig("shared"));
    expect(() => ws.assertReadyForUse()).not.toThrow();
    const wsP = Workspace.rehydrate(makeConfig("private"));
    expect(() => wsP.assertReadyForUse()).not.toThrow();
  });
});

describe("Workspace.rejectReinitialization", () => {
  it("always throws WorkspaceAlreadyInitializedError", () => {
    const ws = Workspace.rehydrate(makeConfig());
    try {
      ws.rejectReinitialization();
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(WorkspaceAlreadyInitializedError);
      expect(
        (err as WorkspaceAlreadyInitializedError).existingWorkspaceId.toString(),
      ).toBe(W_ID);
    }
  });
});
