import { describe, it, expect } from "vitest";

import { DisplayName } from "../../../../../src/modules/workspace/domain/value-objects/display-name.ts";
import { InvalidInputError } from "../../../../../src/shared/domain/errors/invalid-input-error.ts";

describe("DisplayName", () => {
  it("trims and stores", () => {
    const v = DisplayName.create("  Hello  ");
    expect(v.toString()).toBe("Hello");
    expect(v.asString()).toBe("Hello");
    expect(v.length()).toBe(5);
  });

  it("rejects non-string", () => {
    expect(() =>
      DisplayName.create(undefined as unknown as string),
    ).toThrow(InvalidInputError);
  });

  it("rejects empty / whitespace", () => {
    expect(() => DisplayName.create("")).toThrow(InvalidInputError);
    expect(() => DisplayName.create("   ")).toThrow(InvalidInputError);
  });

  it("rejects newlines (\\n / \\r)", () => {
    expect(() => DisplayName.create("a\nb")).toThrow(InvalidInputError);
    expect(() => DisplayName.create("a\rb")).toThrow(InvalidInputError);
  });

  it("respects the max length cap", () => {
    const cap = DisplayName.maxLength();
    const ok = "a".repeat(cap);
    const tooLong = "a".repeat(cap + 1);
    expect(DisplayName.create(ok).toString().length).toBe(cap);
    expect(() => DisplayName.create(tooLong)).toThrow(InvalidInputError);
  });

  it("equals only when same subclass + same canonical text", () => {
    const a = DisplayName.create("Foo");
    const b = DisplayName.create("Foo ");
    expect(a.equals(b)).toBe(true);
    const c = DisplayName.create("Bar");
    expect(a.equals(c)).toBe(false);
  });

  it("maxLength is exposed and >= 1", () => {
    expect(DisplayName.maxLength()).toBeGreaterThanOrEqual(1);
  });
});
