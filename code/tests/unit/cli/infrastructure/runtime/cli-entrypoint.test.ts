import { describe, it, expect } from "vitest";

import { CliEntrypoint } from "../../../../../src/modules/cli/infrastructure/runtime/cli-entrypoint.ts";
import { CommanderCliParser } from "../../../../../src/modules/cli/infrastructure/parser/commander-cli-parser.ts";
import type { RunCliCommand } from "../../../../../src/modules/cli/application/ports/in/run-cli-command.port.ts";
import { CommandOutput } from "../../../../../src/modules/cli/domain/value-objects/command-output.ts";
import { ExitCode } from "../../../../../src/modules/cli/domain/value-objects/exit-code.ts";
import type { CliInvocation } from "../../../../../src/modules/cli/application/dtos/cli-invocation.dto.ts";
import { UnknownCommandError } from "../../../../../src/modules/cli/domain/errors/unknown-command-error.ts";
import {
  RecordingStderr,
  RecordingStdout,
  SilentLogger,
} from "../../../../fixtures/cli-fixtures.ts";

class FakeRunner implements RunCliCommand {
  public lastInvocation: CliInvocation | null = null;
  public output: CommandOutput = CommandOutput.stdoutOnly("ok\n");
  public throws: unknown = null;
  public run(invocation: CliInvocation): Promise<CommandOutput> {
    this.lastInvocation = invocation;
    if (this.throws !== null) {
      const t = this.throws;
      this.throws = null;
      return Promise.reject(t instanceof Error ? t : new Error(String(t)));
    }
    return Promise.resolve(this.output);
  }
}

class FakeParser {
  public output: CliInvocation = {
    command: "stats",
    workspacePath: null,
    nonInteractive: false,
  };
  public throws: unknown = null;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public parse(_argv: readonly string[]): CliInvocation {
    if (this.throws !== null) {
      const t = this.throws;
      this.throws = null;
      throw t instanceof Error ? t : new Error(String(t));
    }
    return this.output;
  }
}

function makeEntry(opts: {
  parser?: CommanderCliParser | FakeParser;
  runner?: RunCliCommand;
} = {}): {
  entry: CliEntrypoint;
  stdout: RecordingStdout;
  stderr: RecordingStderr;
} {
  const stdout = new RecordingStdout();
  const stderr = new RecordingStderr();
  const entry = new CliEntrypoint(
    (opts.parser ?? new CommanderCliParser()) as CommanderCliParser,
    opts.runner ?? new FakeRunner(),
    stdout,
    stderr,
    new SilentLogger(),
  );
  return { entry, stdout, stderr };
}

describe("CliEntrypoint.run — happy path", () => {
  it("parses + runs + writes streams + returns exit code", async () => {
    const runner = new FakeRunner();
    runner.output = CommandOutput.create({
      stdout: "out",
      stderr: "warn",
      exitCode: ExitCode.success(),
    });
    const { entry, stdout, stderr } = makeEntry({ runner });
    const code = await entry.run(["stats"]);
    expect(code).toBe(0);
    expect(stdout.buffer()).toBe("out");
    expect(stderr.buffer()).toBe("warn");
  });

  it("doesn't write empty streams", async () => {
    const runner = new FakeRunner();
    runner.output = CommandOutput.empty();
    const { entry, stdout, stderr } = makeEntry({ runner });
    const code = await entry.run(["stats"]);
    expect(code).toBe(0);
    expect(stdout.buffer()).toBe("");
    expect(stderr.buffer()).toBe("");
  });
});

describe("CliEntrypoint.run — parser errors", () => {
  it("UnknownCommandError → usageError exit + message on stderr", async () => {
    const parser = new FakeParser();
    parser.throws = new UnknownCommandError("innit");
    const { entry, stderr } = makeEntry({ parser });
    const code = await entry.run(["innit"]);
    expect(code).toBe(2);
    expect(stderr.buffer()).toContain("innit");
  });

  it("non-CliDomainError parser failure → usageError exit + 'Error de uso'", async () => {
    const parser = new FakeParser();
    parser.throws = new Error("kaboom");
    const { entry, stderr } = makeEntry({ parser });
    const code = await entry.run(["stats"]);
    expect(code).toBe(2);
    expect(stderr.buffer()).toContain("Error de uso");
  });

  it("non-Error parser throw still surfaces a string on stderr", async () => {
    const parser = new FakeParser();
    parser.throws = "string-throw";
    const { entry, stderr } = makeEntry({ parser });
    const code = await entry.run(["stats"]);
    expect(code).toBe(2);
    expect(stderr.buffer()).toContain("string-throw");
  });
});

describe("CliEntrypoint.run — runner uncaught error", () => {
  it("genericError exit + 'Error: <message>' on stderr", async () => {
    const runner = new FakeRunner();
    runner.throws = new Error("oops");
    const { entry, stderr } = makeEntry({ runner });
    const code = await entry.run(["stats"]);
    expect(code).toBe(1);
    expect(stderr.buffer()).toContain("oops");
  });

  it("non-Error throw still produces stderr text", async () => {
    const runner = new FakeRunner();
    runner.throws = 42 as unknown;
    const { entry, stderr } = makeEntry({ runner });
    const code = await entry.run(["stats"]);
    expect(code).toBe(1);
    expect(stderr.buffer()).toContain("42");
  });
});
