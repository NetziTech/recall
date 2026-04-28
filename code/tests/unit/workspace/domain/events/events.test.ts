import { describe, it, expect } from "vitest";

import { WorkspaceInitialized } from "../../../../../src/modules/workspace/domain/events/workspace-initialized.ts";
import { WorkspaceLocked } from "../../../../../src/modules/workspace/domain/events/workspace-locked.ts";
import { WorkspaceUnlocked } from "../../../../../src/modules/workspace/domain/events/workspace-unlocked.ts";
import { WorkspaceModeChanged } from "../../../../../src/modules/workspace/domain/events/workspace-mode-changed.ts";
import { WorkspaceMode } from "../../../../../src/modules/workspace/domain/value-objects/workspace-mode.ts";
import { WorkspaceId } from "../../../../../src/shared/domain/value-objects/workspace-id.ts";
import { Timestamp } from "../../../../../src/shared/domain/value-objects/timestamp.ts";

const W_ID = "01952f3b-7d8c-7b4a-94f1-a3f8d12e5c89";
const NOW = Timestamp.fromEpochMs(1_700_000_000_000);

describe("Workspace domain events", () => {
  it("WorkspaceInitialized exposes stable event name + payload", () => {
    const e = new WorkspaceInitialized({
      workspaceId: WorkspaceId.from(W_ID),
      mode: WorkspaceMode.encryptedMode(),
      occurredAt: NOW,
    });
    expect(e.eventName).toBe("workspace.initialized");
    expect(e.workspaceId.toString()).toBe(W_ID);
    expect(e.mode.toString()).toBe("encrypted");
    expect(e.occurredAt.equals(NOW)).toBe(true);
  });

  it("WorkspaceLocked exposes stable event name + payload", () => {
    const e = new WorkspaceLocked({
      workspaceId: WorkspaceId.from(W_ID),
      occurredAt: NOW,
    });
    expect(e.eventName).toBe("workspace.locked");
    expect(e.workspaceId.toString()).toBe(W_ID);
    expect(e.occurredAt.equals(NOW)).toBe(true);
  });

  it("WorkspaceUnlocked exposes stable event name + payload", () => {
    const e = new WorkspaceUnlocked({
      workspaceId: WorkspaceId.from(W_ID),
      occurredAt: NOW,
    });
    expect(e.eventName).toBe("workspace.unlocked");
    expect(e.workspaceId.toString()).toBe(W_ID);
  });

  it("WorkspaceModeChanged exposes stable event name + previous/new mode", () => {
    const e = new WorkspaceModeChanged({
      workspaceId: WorkspaceId.from(W_ID),
      previousMode: WorkspaceMode.sharedMode(),
      newMode: WorkspaceMode.privateMode(),
      occurredAt: NOW,
    });
    expect(e.eventName).toBe("workspace.mode-changed");
    expect(e.previousMode.toString()).toBe("shared");
    expect(e.newMode.toString()).toBe("private");
  });
});
