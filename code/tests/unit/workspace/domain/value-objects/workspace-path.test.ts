import { describe, it, expect } from "vitest";

import { WorkspacePath } from "../../../../../src/modules/workspace/domain/value-objects/workspace-path.ts";
import { InvalidInputError } from "../../../../../src/shared/domain/errors/invalid-input-error.ts";

describe("WorkspacePath.create", () => {
  it("accepts a POSIX absolute path", () => {
    expect(WorkspacePath.create("/home/foo").toString()).toBe("/home/foo");
  });

  it("strips trailing separator", () => {
    expect(WorkspacePath.create("/home/foo/").toString()).toBe("/home/foo");
  });

  it("preserves the POSIX root", () => {
    expect(WorkspacePath.create("/").toString()).toBe("/");
  });

  it("preserves a Windows drive root", () => {
    expect(WorkspacePath.create("C:\\").toString()).toBe("C:\\");
    expect(WorkspacePath.create("c:/").toString()).toBe("c:/");
  });

  it("accepts a Windows drive path (both letter cases)", () => {
    expect(WorkspacePath.create("C:\\Users\\you").toString()).toBe(
      "C:\\Users\\you",
    );
    expect(WorkspacePath.create("d:/projects").toString()).toBe("d:/projects");
    expect(WorkspacePath.create("C:\\Users\\you\\").toString()).toBe(
      "C:\\Users\\you",
    );
  });

  it("accepts a Windows UNC path", () => {
    expect(WorkspacePath.create("\\\\server\\share\\foo").toString()).toBe(
      "\\\\server\\share\\foo",
    );
    expect(WorkspacePath.create("//server/share/foo").toString()).toBe(
      "//server/share/foo",
    );
  });

  it("rejects relative paths", () => {
    expect(() => WorkspacePath.create("relative")).toThrow(InvalidInputError);
    expect(() => WorkspacePath.create("./x")).toThrow(InvalidInputError);
    expect(() => WorkspacePath.create("../up")).toThrow(InvalidInputError);
  });

  it("rejects empty / whitespace input", () => {
    expect(() => WorkspacePath.create("")).toThrow(InvalidInputError);
    expect(() => WorkspacePath.create("   ")).toThrow(InvalidInputError);
  });

  it("rejects non-string input", () => {
    expect(() =>
      WorkspacePath.create(undefined as unknown as string),
    ).toThrow(InvalidInputError);
  });

  it("rejects NUL bytes", () => {
    expect(() => WorkspacePath.create("/foo\0bar")).toThrow(InvalidInputError);
  });

  it("trims surrounding whitespace before validating", () => {
    expect(WorkspacePath.create("  /foo  ").toString()).toBe("/foo");
  });
});

describe("WorkspacePath.join", () => {
  it("joins POSIX paths with /", () => {
    const root = WorkspacePath.create("/home/foo");
    expect(root.join(".recall").toString()).toBe("/home/foo/.recall");
  });

  it("joins Windows paths with \\", () => {
    const root = WorkspacePath.create("C:\\Users\\you");
    expect(root.join("project").toString()).toBe("C:\\Users\\you\\project");
  });

  it("joins Windows-with-forward-slash with /", () => {
    const root = WorkspacePath.create("C:/Users/you");
    expect(root.join("project").toString()).toBe("C:/Users/you/project");
  });

  it("joins UNC paths with \\", () => {
    const root = WorkspacePath.create("\\\\srv\\share");
    expect(root.join("project").toString()).toBe("\\\\srv\\share\\project");
  });

  it("strips a leading separator from the relative segment", () => {
    const root = WorkspacePath.create("/home/foo");
    expect(root.join("/bar/").toString()).toBe("/home/foo/bar");
    expect(root.join("\\bar").toString()).toBe("/home/foo/bar");
  });

  it("rejects non-string segment", () => {
    const root = WorkspacePath.create("/home/foo");
    expect(() => root.join(undefined as unknown as string)).toThrow(
      InvalidInputError,
    );
  });

  it("rejects empty / whitespace segment", () => {
    const root = WorkspacePath.create("/home/foo");
    expect(() => root.join("   ")).toThrow(InvalidInputError);
  });

  it("rejects NUL byte in segment", () => {
    const root = WorkspacePath.create("/home/foo");
    expect(() => root.join("a\0b")).toThrow(InvalidInputError);
  });
});

describe("WorkspacePath equals + toString", () => {
  it("equals compares canonical strings exactly", () => {
    expect(
      WorkspacePath.create("/foo").equals(WorkspacePath.create("/foo/")),
    ).toBe(true);
    expect(
      WorkspacePath.create("/foo").equals(WorkspacePath.create("/bar")),
    ).toBe(false);
  });
});
