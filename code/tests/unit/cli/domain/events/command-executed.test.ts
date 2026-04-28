import { describe, it, expect } from "vitest";

import { CommandExecuted } from "../../../../../src/modules/cli/domain/events/command-executed.ts";
import { CommandExecution } from "../../../../../src/modules/cli/domain/value-objects/command-execution.ts";
import { CommandName } from "../../../../../src/modules/cli/domain/value-objects/command-name.ts";
import { CommandArgs } from "../../../../../src/modules/cli/domain/value-objects/command-args.ts";
import { CommandOutput } from "../../../../../src/modules/cli/domain/value-objects/command-output.ts";
import { WorkspaceId } from "../../../../../src/shared/domain/value-objects/workspace-id.ts";
import { Timestamp } from "../../../../../src/shared/domain/value-objects/timestamp.ts";

const W_ID = "00000000-0000-7000-8000-000000000001";

describe("CommandExecuted", () => {
  it("exposes the canonical event name + payload", () => {
    const ts = Timestamp.fromEpochMs(1234);
    const exe = CommandExecution.create({
      name: CommandName.create("stats"),
      args: CommandArgs.empty(),
      startedAt: ts,
      endedAt: ts,
      output: CommandOutput.empty(),
    });
    const e = new CommandExecuted({
      workspaceId: WorkspaceId.from(W_ID),
      execution: exe,
      occurredAt: ts,
    });
    expect(e.eventName).toBe("cli.command-executed");
    expect(e.workspaceId.toString()).toBe(W_ID);
    expect(e.execution).toBe(exe);
    expect(e.occurredAt.equals(ts)).toBe(true);
  });
});
