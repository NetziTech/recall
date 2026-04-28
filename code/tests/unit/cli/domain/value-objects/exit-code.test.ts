import { describe, it, expect } from "vitest";

import { ExitCode } from "../../../../../src/modules/cli/domain/value-objects/exit-code.ts";
import { InvalidExitCodeError } from "../../../../../src/modules/cli/domain/errors/invalid-exit-code-error.ts";

describe("ExitCode.from(kind)", () => {
  it.each([
    ["success", 0],
    ["genericError", 1],
    ["usageError", 2],
    ["invalidConfig", 3],
    ["lockedWorkspace", 4],
    ["invalidKey", 5],
    ["keyRevoked", 6],
    ["secretDetected", 7],
  ] as const)("%s -> %d", (k, n) => {
    const e = ExitCode.from(k);
    expect(e.value).toBe(n);
    expect(e.kind).toBe(k);
    expect(e.toNumber()).toBe(n);
  });

  it("isSuccess / isFailure", () => {
    expect(ExitCode.from("success").isSuccess()).toBe(true);
    expect(ExitCode.from("success").isFailure()).toBe(false);
    expect(ExitCode.from("genericError").isFailure()).toBe(true);
    expect(ExitCode.from("genericError").isSuccess()).toBe(false);
  });

  it("success() is a convenience for from('success')", () => {
    expect(ExitCode.success().value).toBe(0);
    expect(ExitCode.success().kind).toBe("success");
  });

  it("equals compares value not kind", () => {
    const a = ExitCode.from("success");
    const b = ExitCode.fromValue(0);
    expect(a.equals(b)).toBe(true);
  });
});

describe("ExitCode.fromValue(n)", () => {
  it("known catalog values surface their kind", () => {
    expect(ExitCode.fromValue(0).kind).toBe("success");
    expect(ExitCode.fromValue(7).kind).toBe("secretDetected");
  });

  it("non-cataloged values yield kind=null but are accepted", () => {
    const e = ExitCode.fromValue(42);
    expect(e.value).toBe(42);
    expect(e.kind).toBeNull();
  });

  it("rejects NaN, Infinity, fractional", () => {
    expect(() => ExitCode.fromValue(Number.NaN)).toThrow(InvalidExitCodeError);
    expect(() => ExitCode.fromValue(Number.POSITIVE_INFINITY)).toThrow(
      InvalidExitCodeError,
    );
    expect(() => ExitCode.fromValue(1.5)).toThrow(InvalidExitCodeError);
  });

  it("rejects negative + above 255", () => {
    expect(() => ExitCode.fromValue(-1)).toThrow(InvalidExitCodeError);
    expect(() => ExitCode.fromValue(256)).toThrow(InvalidExitCodeError);
  });

  it("accepts 255 (POSIX max)", () => {
    expect(ExitCode.fromValue(255).value).toBe(255);
  });
});
