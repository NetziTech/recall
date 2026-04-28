import { describe, it, expect } from "vitest";
import * as path from "node:path";
import process from "node:process";

import { resolveRootPath } from "../../../../../src/modules/cli/application/use-cases/handlers/root-path.ts";
import { InvariantViolationError } from "../../../../../src/shared/domain/errors/invariant-violation-error.ts";

describe("resolveRootPath", () => {
  it("defaults to cwd when null", () => {
    expect(resolveRootPath(null)).toBe(path.resolve(process.cwd()));
  });

  it("resolves a relative path against cwd", () => {
    expect(resolveRootPath("foo")).toBe(path.resolve("foo"));
  });

  it("preserves an absolute path", () => {
    expect(resolveRootPath("/tmp/x")).toBe(path.resolve("/tmp/x"));
  });

  it("rejects NUL bytes", () => {
    expect(() => resolveRootPath("/tmp/\0bad")).toThrow(InvariantViolationError);
  });
});
