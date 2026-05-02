import { describe, it, expect } from "vitest";

import {
  RunCliCommandUseCase,
  eraseHandler,
} from "../../../../../src/modules/cli/application/use-cases/run-cli-command.use-case.ts";
import { CommandOutput } from "../../../../../src/modules/cli/domain/value-objects/command-output.ts";
import { ExitCode } from "../../../../../src/modules/cli/domain/value-objects/exit-code.ts";
import { InvariantViolationError } from "../../../../../src/shared/domain/errors/invariant-violation-error.ts";
import type { CommandHandler } from "../../../../../src/modules/cli/application/ports/in/command-handler.port.ts";
import type {
  CliInvocation,
  CliStatsInvocation,
} from "../../../../../src/modules/cli/application/dtos/cli-invocation.dto.ts";
import { SilentLogger } from "../../../../fixtures/cli-fixtures.ts";

class StatsHandler implements CommandHandler<"stats"> {
  public readonly command = "stats" as const;
  public callCount = 0;
  public output: CommandOutput = CommandOutput.stdoutOnly("ok");
  public throws: unknown = null;
   
  public handle(_inv: CliStatsInvocation): Promise<CommandOutput> {
    this.callCount += 1;
    if (this.throws !== null) {
      const t = this.throws;
      this.throws = null;
      // Reject verbatim — including non-Error shapes — so the use case's
      // classifyErrorAsExitCode helper can pattern-match on `code`.
      return Promise.reject(t as Error);
    }
    return Promise.resolve(this.output);
  }
}

const STATS_INV: CliInvocation = {
  command: "stats",
  workspacePath: null,
  nonInteractive: false,
};

describe("RunCliCommandUseCase", () => {
  it("dispatches to the registered handler", async () => {
    const handler = new StatsHandler();
    const uc = new RunCliCommandUseCase(
      [eraseHandler(handler)],
      new SilentLogger(),
    );
    const out = await uc.run(STATS_INV);
    expect(handler.callCount).toBe(1);
    expect(out.stdout).toBe("ok");
  });

  it("returns genericError + stderr when no handler is registered", async () => {
    const uc = new RunCliCommandUseCase([], new SilentLogger());
    const out = await uc.run(STATS_INV);
    expect(out.exitCode.toNumber()).toBe(1);
    expect(out.stderr).toContain("no handler");
  });

  it("rejects duplicate handler registration", () => {
    const a = new StatsHandler();
    const b = new StatsHandler();
    expect(
      () =>
        new RunCliCommandUseCase(
          [eraseHandler(a), eraseHandler(b)],
          new SilentLogger(),
        ),
    ).toThrow(InvariantViolationError);
  });

  it("classifies a thrown workspace.locked → lockedWorkspace exit", async () => {
    const handler = new StatsHandler();
    const err: { code: string; message: string } = {
      code: "workspace.locked",
      message: "locked",
    };
    handler.throws = err;
    const uc = new RunCliCommandUseCase(
      [eraseHandler(handler)],
      new SilentLogger(),
    );
    const out = await uc.run(STATS_INV);
    expect(out.exitCode.toNumber()).toBe(4);
  });

  it("classifies encryption.key-validation-failed → invalidKey", async () => {
    const handler = new StatsHandler();
    handler.throws = { code: "encryption.key-validation-failed", message: "x" };
    const uc = new RunCliCommandUseCase(
      [eraseHandler(handler)],
      new SilentLogger(),
    );
    const out = await uc.run(STATS_INV);
    expect(out.exitCode.toNumber()).toBe(5);
  });

  it("classifies workspace.app.no-workspace-at-path → invalidConfig", async () => {
    const handler = new StatsHandler();
    handler.throws = { code: "workspace.app.no-workspace-at-path", message: "x" };
    const uc = new RunCliCommandUseCase(
      [eraseHandler(handler)],
      new SilentLogger(),
    );
    const out = await uc.run(STATS_INV);
    expect(out.exitCode.toNumber()).toBe(3);
  });

  it("classifies workspace.config-* → invalidConfig", async () => {
    for (const code of ["workspace.config-missing", "workspace.config-malformed"]) {
      const handler = new StatsHandler();
      handler.throws = { code, message: code };
      const uc = new RunCliCommandUseCase(
        [eraseHandler(handler)],
        new SilentLogger(),
      );
      const out = await uc.run(STATS_INV);
      expect(out.exitCode.toNumber()).toBe(3);
    }
  });

  it("classifies secrets.detected / secret.detected → secretDetected", async () => {
    for (const code of ["secrets.detected", "secret.detected"]) {
      const handler = new StatsHandler();
      handler.throws = { code, message: code };
      const uc = new RunCliCommandUseCase(
        [eraseHandler(handler)],
        new SilentLogger(),
      );
      const out = await uc.run(STATS_INV);
      expect(out.exitCode.toNumber()).toBe(7);
    }
  });

  it("classifies cli.* → usageError", async () => {
    for (const code of ["cli.invalid-command-args", "cli.unknown-command"]) {
      const handler = new StatsHandler();
      handler.throws = { code, message: code };
      const uc = new RunCliCommandUseCase(
        [eraseHandler(handler)],
        new SilentLogger(),
      );
      const out = await uc.run(STATS_INV);
      expect(out.exitCode.toNumber()).toBe(2);
    }
  });

  it("falls through to genericError on unknown shape", async () => {
    const handler = new StatsHandler();
    handler.throws = "string-not-object";
    const uc = new RunCliCommandUseCase(
      [eraseHandler(handler)],
      new SilentLogger(),
    );
    const out = await uc.run(STATS_INV);
    expect(out.exitCode.toNumber()).toBe(1);
  });

  it("falls through to genericError when err.code is non-string", async () => {
    const handler = new StatsHandler();
    handler.throws = { code: 123 };
    const uc = new RunCliCommandUseCase(
      [eraseHandler(handler)],
      new SilentLogger(),
    );
    const out = await uc.run(STATS_INV);
    expect(out.exitCode.toNumber()).toBe(1);
  });

  it("falls through to genericError for an unrecognised code", async () => {
    const handler = new StatsHandler();
    handler.throws = { code: "unknown.error", message: "x" };
    const uc = new RunCliCommandUseCase(
      [eraseHandler(handler)],
      new SilentLogger(),
    );
    const out = await uc.run(STATS_INV);
    expect(out.exitCode.toNumber()).toBe(1);
  });

  it("formats the stderr for non-Error throws as 'Error: <stringified>'", async () => {
    const handler = new StatsHandler();
    handler.throws = 42 as unknown;
    const uc = new RunCliCommandUseCase(
      [eraseHandler(handler)],
      new SilentLogger(),
    );
    const out = await uc.run(STATS_INV);
    expect(out.stderr).toContain("Error: 42");
  });
});

describe("eraseHandler", () => {
  it("guards against routing mismatch at runtime", () => {
    const handler = new StatsHandler();
    const erased = eraseHandler(handler);
    // The erased.handle synchronously throws before returning a Promise,
    // so we wrap with a function and use toThrow instead of rejects.
    expect(() =>
      erased.handle({
        command: "health",
        workspacePath: null,
        nonInteractive: false,
      } as CliInvocation),
    ).toThrow(InvariantViolationError);
  });

  it("returns whatever the underlying handler returns", async () => {
    const handler = new StatsHandler();
    handler.output = CommandOutput.create({
      stdout: "x",
      stderr: "",
      exitCode: ExitCode.success(),
    });
    const out = await eraseHandler(handler).handle(STATS_INV);
    expect(out.stdout).toBe("x");
  });
});
