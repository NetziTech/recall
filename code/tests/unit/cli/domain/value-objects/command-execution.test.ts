import { describe, it, expect } from "vitest";

import { CommandExecution } from "../../../../../src/modules/cli/domain/value-objects/command-execution.ts";
import { CommandName } from "../../../../../src/modules/cli/domain/value-objects/command-name.ts";
import { CommandArgs } from "../../../../../src/modules/cli/domain/value-objects/command-args.ts";
import { CommandOutput } from "../../../../../src/modules/cli/domain/value-objects/command-output.ts";
import { ExitCode } from "../../../../../src/modules/cli/domain/value-objects/exit-code.ts";
import { Timestamp } from "../../../../../src/shared/domain/value-objects/timestamp.ts";
import { InvariantViolationError } from "../../../../../src/shared/domain/errors/invariant-violation-error.ts";

const NAME = CommandName.create("stats");
const ARGS = CommandArgs.empty();
const OUT = CommandOutput.empty();

describe("CommandExecution.create", () => {
  it("accepts endedAt >= startedAt", () => {
    const a = Timestamp.fromEpochMs(1000);
    const b = Timestamp.fromEpochMs(2000);
    const e = CommandExecution.create({
      name: NAME,
      args: ARGS,
      startedAt: a,
      endedAt: b,
      output: OUT,
    });
    expect(e.durationMs()).toBe(1000);
    expect(e.wasSuccessful()).toBe(true);
  });

  it("accepts startedAt == endedAt (zero duration)", () => {
    const t = Timestamp.fromEpochMs(1000);
    const e = CommandExecution.create({
      name: NAME,
      args: ARGS,
      startedAt: t,
      endedAt: t,
      output: OUT,
    });
    expect(e.durationMs()).toBe(0);
  });

  it("rejects endedAt < startedAt", () => {
    expect(() =>
      CommandExecution.create({
        name: NAME,
        args: ARGS,
        startedAt: Timestamp.fromEpochMs(2000),
        endedAt: Timestamp.fromEpochMs(1000),
        output: OUT,
      }),
    ).toThrow(InvariantViolationError);
  });
});

describe("CommandExecution behaviour", () => {
  const t1 = Timestamp.fromEpochMs(1000);
  const t2 = Timestamp.fromEpochMs(2000);
  const failure = CommandOutput.failure({
    stderr: "no",
    exitCode: ExitCode.from("genericError"),
  });

  it("wasSuccessful delegates to output.isSuccess", () => {
    const ok = CommandExecution.create({
      name: NAME,
      args: ARGS,
      startedAt: t1,
      endedAt: t2,
      output: OUT,
    });
    const ko = CommandExecution.create({
      name: NAME,
      args: ARGS,
      startedAt: t1,
      endedAt: t2,
      output: failure,
    });
    expect(ok.wasSuccessful()).toBe(true);
    expect(ko.wasSuccessful()).toBe(false);
  });

  it("equals: every field matches", () => {
    const a = CommandExecution.create({
      name: NAME,
      args: ARGS,
      startedAt: t1,
      endedAt: t2,
      output: OUT,
    });
    const b = CommandExecution.create({
      name: NAME,
      args: ARGS,
      startedAt: t1,
      endedAt: t2,
      output: OUT,
    });
    expect(a.equals(b)).toBe(true);
  });

  it("equals: differs by any field", () => {
    const a = CommandExecution.create({
      name: NAME,
      args: ARGS,
      startedAt: t1,
      endedAt: t2,
      output: OUT,
    });
    const b = CommandExecution.create({
      name: CommandName.create("health"),
      args: ARGS,
      startedAt: t1,
      endedAt: t2,
      output: OUT,
    });
    expect(a.equals(b)).toBe(false);
  });
});
