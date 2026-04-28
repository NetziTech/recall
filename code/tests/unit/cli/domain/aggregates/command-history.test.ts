import { describe, it, expect } from "vitest";

import { CommandHistory } from "../../../../../src/modules/cli/domain/aggregates/command-history.ts";
import { CommandExecution } from "../../../../../src/modules/cli/domain/value-objects/command-execution.ts";
import { CommandName } from "../../../../../src/modules/cli/domain/value-objects/command-name.ts";
import { CommandArgs } from "../../../../../src/modules/cli/domain/value-objects/command-args.ts";
import { CommandOutput } from "../../../../../src/modules/cli/domain/value-objects/command-output.ts";
import { CommandExecuted } from "../../../../../src/modules/cli/domain/events/command-executed.ts";
import { WorkspaceId } from "../../../../../src/shared/domain/value-objects/workspace-id.ts";
import { Timestamp } from "../../../../../src/shared/domain/value-objects/timestamp.ts";
import { InvalidInputError } from "../../../../../src/shared/domain/errors/invalid-input-error.ts";
import { InvariantViolationError } from "../../../../../src/shared/domain/errors/invariant-violation-error.ts";

const W_ID = "00000000-0000-7000-8000-000000000001";

function exec(endedAtMs: number, name = "stats"): CommandExecution {
  return CommandExecution.create({
    name: CommandName.create(name),
    args: CommandArgs.empty(),
    startedAt: Timestamp.fromEpochMs(endedAtMs - 10),
    endedAt: Timestamp.fromEpochMs(endedAtMs),
    output: CommandOutput.empty(),
  });
}

describe("CommandHistory.empty", () => {
  it("default capacity = 50, isEmpty=true", () => {
    const h = CommandHistory.empty({
      workspaceId: WorkspaceId.from(W_ID),
    });
    expect(h.getCapacity()).toBe(50);
    expect(h.isEmpty()).toBe(true);
    expect(h.size()).toBe(0);
    expect(h.latest()).toBeNull();
    expect(h.recentExecutions()).toEqual([]);
    expect(h.pullEvents()).toEqual([]);
  });

  it("rejects capacity < 1", () => {
    expect(() =>
      CommandHistory.empty({
        workspaceId: WorkspaceId.from(W_ID),
        capacity: 0,
      }),
    ).toThrow(InvalidInputError);
  });

  it("rejects fractional capacity", () => {
    expect(() =>
      CommandHistory.empty({
        workspaceId: WorkspaceId.from(W_ID),
        capacity: 1.5,
      }),
    ).toThrow(InvalidInputError);
  });

  it("rejects capacity > MAX (1000)", () => {
    expect(() =>
      CommandHistory.empty({
        workspaceId: WorkspaceId.from(W_ID),
        capacity: 1001,
      }),
    ).toThrow(InvalidInputError);
  });
});

describe("CommandHistory.recordExecution", () => {
  it("appends and emits CommandExecuted", () => {
    const h = CommandHistory.empty({ workspaceId: WorkspaceId.from(W_ID) });
    h.recordExecution(exec(1000));
    expect(h.size()).toBe(1);
    expect(h.latest()?.endedAt.toEpochMs()).toBe(1000);
    const events = h.pullEvents();
    expect(events.length).toBe(1);
    expect(events[0]).toBeInstanceOf(CommandExecuted);
    expect(h.pullEvents().length).toBe(0); // drained
  });

  it("monotonic invariant: refuses out-of-order endedAt", () => {
    const h = CommandHistory.empty({ workspaceId: WorkspaceId.from(W_ID) });
    h.recordExecution(exec(2000));
    expect(() => h.recordExecution(exec(1000))).toThrow(InvariantViolationError);
  });

  it("equal timestamps allowed", () => {
    const h = CommandHistory.empty({ workspaceId: WorkspaceId.from(W_ID) });
    h.recordExecution(exec(1000));
    h.recordExecution(exec(1000));
    expect(h.size()).toBe(2);
  });

  it("evicts the oldest when capacity is exceeded", () => {
    const h = CommandHistory.empty({
      workspaceId: WorkspaceId.from(W_ID),
      capacity: 2,
    });
    h.recordExecution(exec(1000));
    h.recordExecution(exec(2000));
    h.recordExecution(exec(3000));
    expect(h.size()).toBe(2);
    const recents = h.recentExecutions();
    expect(recents[0]?.endedAt.toEpochMs()).toBe(3000);
    expect(recents[1]?.endedAt.toEpochMs()).toBe(2000);
  });
});

describe("CommandHistory.recentExecutions", () => {
  const h = CommandHistory.empty({
    workspaceId: WorkspaceId.from(W_ID),
    capacity: 5,
  });
  h.recordExecution(exec(1000));
  h.recordExecution(exec(2000));
  h.recordExecution(exec(3000));

  it("default returns full buffer newest-first", () => {
    const r = h.recentExecutions();
    expect(r.map((e) => e.endedAt.toEpochMs())).toEqual([3000, 2000, 1000]);
  });

  it("respects an explicit limit", () => {
    const r = h.recentExecutions(2);
    expect(r.length).toBe(2);
    expect(r[0]?.endedAt.toEpochMs()).toBe(3000);
  });

  it("limit greater than size returns full buffer", () => {
    const r = h.recentExecutions(99);
    expect(r.length).toBe(3);
  });

  it("limit=0 returns frozen empty", () => {
    const r = h.recentExecutions(0);
    expect(r).toEqual([]);
    expect(Object.isFrozen(r)).toBe(true);
  });

  it("rejects fractional / negative limit", () => {
    expect(() => h.recentExecutions(1.5)).toThrow(InvalidInputError);
    expect(() => h.recentExecutions(-1)).toThrow(InvalidInputError);
  });

  it("returned array is frozen", () => {
    const r = h.recentExecutions();
    expect(Object.isFrozen(r)).toBe(true);
  });
});

describe("CommandHistory.rehydrate", () => {
  it("accepts well-ordered executions", () => {
    const h = CommandHistory.rehydrate({
      workspaceId: WorkspaceId.from(W_ID),
      capacity: 10,
      executions: [exec(1000), exec(2000), exec(3000)],
    });
    expect(h.size()).toBe(3);
  });

  it("rejects when executions exceed capacity", () => {
    expect(() =>
      CommandHistory.rehydrate({
        workspaceId: WorkspaceId.from(W_ID),
        capacity: 1,
        executions: [exec(1000), exec(2000)],
      }),
    ).toThrow(InvariantViolationError);
  });

  it("rejects out-of-order executions", () => {
    expect(() =>
      CommandHistory.rehydrate({
        workspaceId: WorkspaceId.from(W_ID),
        capacity: 10,
        executions: [exec(2000), exec(1000)],
      }),
    ).toThrow(InvariantViolationError);
  });
});

describe("CommandHistory.equals + getId", () => {
  it("equals by workspace id only", () => {
    const id = WorkspaceId.from(W_ID);
    const a = CommandHistory.empty({ workspaceId: id });
    const b = CommandHistory.empty({ workspaceId: id });
    expect(a.equals(b)).toBe(true);
    a.recordExecution(exec(1000));
    expect(a.equals(b)).toBe(true); // identity unchanged
  });

  it("getId returns the workspaceId", () => {
    const id = WorkspaceId.from(W_ID);
    const h = CommandHistory.empty({ workspaceId: id });
    expect(h.getId().equals(id)).toBe(true);
  });
});
