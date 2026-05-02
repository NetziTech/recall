import { describe, it, expect, vi } from "vitest";

import { CliEntrypoint } from "../../../../../src/modules/cli/infrastructure/runtime/cli-entrypoint.ts";
import { CommanderCliParser } from "../../../../../src/modules/cli/infrastructure/parser/commander-cli-parser.ts";
import type { RunCliCommand } from "../../../../../src/modules/cli/application/ports/in/run-cli-command.port.ts";
import { CommandOutput } from "../../../../../src/modules/cli/domain/value-objects/command-output.ts";
import { ExitCode } from "../../../../../src/modules/cli/domain/value-objects/exit-code.ts";
import type { CliInvocation } from "../../../../../src/modules/cli/application/dtos/cli-invocation.dto.ts";
import { HelpRequestedSignal } from "../../../../../src/modules/cli/domain/errors/help-requested-signal.ts";
import { UnknownCommandError } from "../../../../../src/modules/cli/domain/errors/unknown-command-error.ts";
import type { Logger } from "../../../../../src/shared/application/ports/logger.port.ts";
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

describe("CliEntrypoint.run — help / version signal (B-CLI-1)", () => {
  /**
   * Recording logger so the test can assert the help path NEVER
   * touches the error-level sink. Before B-CLI-1 the entrypoint
   * logged `CLI parser threw unexpectedly` at error level after every
   * `--help`, polluting the log even on a clean help request.
   */
  class CountingLogger implements Logger {
    public traceCount = 0;
    public debugCount = 0;
    public infoCount = 0;
    public warnCount = 0;
    public errorCount = 0;
    public fatalCount = 0;
    public trace(): void {
      this.traceCount += 1;
    }
    public debug(): void {
      this.debugCount += 1;
    }
    public info(): void {
      this.infoCount += 1;
    }
    public warn(): void {
      this.warnCount += 1;
    }
    public error(): void {
      this.errorCount += 1;
    }
    public fatal(): void {
      this.fatalCount += 1;
    }
    public child(): Logger {
      return this;
    }
  }

  it("HelpRequestedSignal → exit 0, no log, no stderr", async () => {
    const parser = new FakeParser();
    parser.throws = new HelpRequestedSignal("(outputHelp)");
    const stdout = new RecordingStdout();
    const stderr = new RecordingStderr();
    const logger = new CountingLogger();
    const entry = new CliEntrypoint(
      new CommanderCliParser(),
      new FakeRunner(),
      stdout,
      stderr,
      logger,
    );
    // Inject the FakeParser via a private cast — the entrypoint
    // narrows on its CommanderCliParser dependency, but the real
    // parser would not synthesise the signal in this test path.
    (entry as unknown as { parser: FakeParser }).parser = parser;

    const code = await entry.run(["--help"]);
    expect(code).toBe(0);
    expect(stderr.buffer()).toBe("");
    // Critical: the entrypoint must NOT log the signal as an error.
    expect(logger.errorCount).toBe(0);
    expect(logger.warnCount).toBe(0);
  });

  it("end-to-end: real CommanderCliParser + --help → exit 0 + Usage in stdout", async () => {
    // This test exercises the real parser to guard against the parser
    // being changed to throw a different shape in the future.
    // Commander writes the help text directly to stdout via
    // `process.stdout.write` (it does NOT route through our `Stdout`
    // port), so we hijack the write call with a vi spy and assert the
    // help banner landed there before the entrypoint exits.
    const writeSpy = vi
      .spyOn(process.stdout, "write")
      // Suppress the help dump so vitest's reporter does not mix CLI
      // banner text with its own progress output. Returns `true` to
      // mimic `process.stdout.write`'s back-pressure flag.
      .mockImplementation(() => true);
    try {
      const stdout = new RecordingStdout();
      const stderr = new RecordingStderr();
      const logger = new CountingLogger();
      const entry = new CliEntrypoint(
        new CommanderCliParser(),
        new FakeRunner(),
        stdout,
        stderr,
        logger,
      );
      const code = await entry.run(["--help"]);
      expect(code).toBe(0);
      expect(stderr.buffer()).toBe("");
      expect(logger.errorCount).toBe(0);

      const captured = writeSpy.mock.calls
        .map((call) => String(call[0]))
        .join("");
      expect(captured).toContain("Usage: recall");
    } finally {
      writeSpy.mockRestore();
    }
  });

  it("subcommand --help also exits 0 cleanly", async () => {
    const writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    try {
      const logger = new CountingLogger();
      const stdout = new RecordingStdout();
      const stderr = new RecordingStderr();
      const entry = new CliEntrypoint(
        new CommanderCliParser(),
        new FakeRunner(),
        stdout,
        stderr,
        logger,
      );
      const code = await entry.run(["init", "--help"]);
      expect(code).toBe(0);
      expect(stderr.buffer()).toBe("");
      expect(logger.errorCount).toBe(0);
    } finally {
      writeSpy.mockRestore();
    }
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
