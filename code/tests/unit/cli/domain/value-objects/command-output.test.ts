import { describe, it, expect } from "vitest";

import { CommandOutput } from "../../../../../src/modules/cli/domain/value-objects/command-output.ts";
import { ExitCode } from "../../../../../src/modules/cli/domain/value-objects/exit-code.ts";

describe("CommandOutput factories", () => {
  it("create with explicit fields", () => {
    const o = CommandOutput.create({
      stdout: "out",
      stderr: "err",
      exitCode: ExitCode.from("success"),
    });
    expect(o.stdout).toBe("out");
    expect(o.stderr).toBe("err");
    expect(o.exitCode.equals(ExitCode.success())).toBe(true);
    expect(o.isSuccess()).toBe(true);
  });

  it("empty()", () => {
    const o = CommandOutput.empty();
    expect(o.stdout).toBe("");
    expect(o.stderr).toBe("");
    expect(o.isSuccess()).toBe(true);
  });

  it("stdoutOnly()", () => {
    const o = CommandOutput.stdoutOnly("hello");
    expect(o.stdout).toBe("hello");
    expect(o.stderr).toBe("");
    expect(o.isSuccess()).toBe(true);
  });

  it("failure()", () => {
    const o = CommandOutput.failure({
      stderr: "boom",
      exitCode: ExitCode.from("genericError"),
    });
    expect(o.stdout).toBe("");
    expect(o.stderr).toBe("boom");
    expect(o.isSuccess()).toBe(false);
  });
});

describe("CommandOutput builders (replace semantics)", () => {
  const base = CommandOutput.create({
    stdout: "x",
    stderr: "y",
    exitCode: ExitCode.success(),
  });

  it("withStdout replaces", () => {
    const next = base.withStdout("z");
    expect(next.stdout).toBe("z");
    expect(next.stderr).toBe("y");
    expect(next.exitCode.equals(base.exitCode)).toBe(true);
    expect(base.stdout).toBe("x"); // immutable
  });

  it("withStderr replaces", () => {
    const next = base.withStderr("zz");
    expect(next.stderr).toBe("zz");
    expect(next.stdout).toBe("x");
  });

  it("withExitCode replaces", () => {
    const next = base.withExitCode(ExitCode.from("genericError"));
    expect(next.exitCode.toNumber()).toBe(1);
    expect(next.stdout).toBe("x");
  });
});

describe("CommandOutput equals", () => {
  it("equal when all three fields match", () => {
    const a = CommandOutput.empty();
    const b = CommandOutput.empty();
    expect(a.equals(b)).toBe(true);
  });

  it("not equal when any field differs", () => {
    const a = CommandOutput.empty();
    expect(a.equals(a.withStdout("a"))).toBe(false);
    expect(a.equals(a.withStderr("b"))).toBe(false);
    expect(a.equals(a.withExitCode(ExitCode.from("genericError")))).toBe(false);
  });
});
