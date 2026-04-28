import { describe, it, expect } from "vitest";

import { CliInfrastructureError } from "../../../../../src/modules/cli/infrastructure/errors/cli-infrastructure-error.ts";
import { InfrastructureError } from "../../../../../src/shared/infrastructure/errors/infrastructure-error.ts";

describe("CliInfrastructureError factories", () => {
  it("parserInternalError", () => {
    const cause = new Error("u");
    const e = CliInfrastructureError.parserInternalError(cause);
    expect(e).toBeInstanceOf(InfrastructureError);
    expect(e.code).toBe("cli.parser-internal-error");
    expect((e as unknown as { cause: unknown }).cause).toBe(cause);
  });

  it("ttyIoError", () => {
    const cause = new Error("u");
    const e = CliInfrastructureError.ttyIoError(cause);
    expect(e.code).toBe("cli.tty-io-error");
    expect((e as unknown as { cause: unknown }).cause).toBe(cause);
  });
});
