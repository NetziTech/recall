import { describe, it, expect } from "vitest";

import { CliDomainError } from "../../../../../src/modules/cli/domain/errors/cli-domain-error.ts";
import { UnknownCommandError } from "../../../../../src/modules/cli/domain/errors/unknown-command-error.ts";
import { InvalidCommandArgsError } from "../../../../../src/modules/cli/domain/errors/invalid-command-args-error.ts";
import { InvalidExitCodeError } from "../../../../../src/modules/cli/domain/errors/invalid-exit-code-error.ts";
import { DomainError } from "../../../../../src/shared/domain/errors/domain-error.ts";

describe("CLI domain errors", () => {
  it("UnknownCommandError carries the attempted token verbatim", () => {
    const e = new UnknownCommandError("INNIT");
    expect(e).toBeInstanceOf(CliDomainError);
    expect(e).toBeInstanceOf(DomainError);
    expect(e.code).toBe("cli.unknown-command");
    expect(e.attempted).toBe("INNIT");
    expect(e.jsonRpcCode).toBeNull();
    expect(e.message).toContain("INNIT");
  });

  it("UnknownCommandError captures cause", () => {
    const cause = new Error("u");
    const e = new UnknownCommandError("x", cause);
    expect((e as unknown as { cause: unknown }).cause).toBe(cause);
  });

  it("InvalidCommandArgsError captures command + field + cause", () => {
    const cause = new Error("u");
    const e = new InvalidCommandArgsError(
      "bad mode",
      {
        commandName: "init",
        field: "mode",
      },
      cause,
    );
    expect(e.code).toBe("cli.invalid-command-args");
    expect(e.commandName).toBe("init");
    expect(e.field).toBe("mode");
    expect((e as unknown as { cause: unknown }).cause).toBe(cause);
    expect(e.jsonRpcCode).toBeNull();
  });

  it("InvalidCommandArgsError accepts no field/cause", () => {
    const e = new InvalidCommandArgsError("bad", { commandName: "init" });
    expect(e.field).toBeNull();
  });

  it("InvalidExitCodeError captures the attempted number", () => {
    const e = new InvalidExitCodeError(-1);
    expect(e.code).toBe("cli.invalid-exit-code");
    expect(e.attempted).toBe(-1);
    expect(e.jsonRpcCode).toBeNull();

    const cause = new Error("u");
    const e2 = new InvalidExitCodeError(999, cause);
    expect((e2 as unknown as { cause: unknown }).cause).toBe(cause);
  });
});
