import { describe, it, expect } from "vitest";
import { KeyLabel } from "../../../../../src/modules/encryption/domain/value-objects/key-label.ts";
import { InvalidInputError } from "../../../../../src/shared/domain/errors/invalid-input-error.ts";

describe("KeyLabel", () => {
  it("create() accepts a valid label", () => {
    const l = KeyLabel.create("alice@laptop");
    expect(l.toString()).toBe("alice@laptop");
    expect(l.asString()).toBe("alice@laptop");
  });

  it("create() trims whitespace", () => {
    const l = KeyLabel.create("  bob@desktop  ");
    expect(l.toString()).toBe("bob@desktop");
  });

  it("create() rejects empty string", () => {
    expect(() => KeyLabel.create("")).toThrow(InvalidInputError);
  });

  it("create() rejects whitespace-only", () => {
    expect(() => KeyLabel.create("   ")).toThrow(InvalidInputError);
  });

  it("create() rejects non-string", () => {
    expect(() =>
      KeyLabel.create(123 as unknown as string),
    ).toThrow(InvalidInputError);
  });

  it("create() rejects newline", () => {
    expect(() => KeyLabel.create("foo\nbar")).toThrow(InvalidInputError);
  });

  it("create() rejects carriage return", () => {
    expect(() => KeyLabel.create("foo\rbar")).toThrow(InvalidInputError);
  });

  it("create() rejects label > maxLength", () => {
    expect(() => KeyLabel.create("a".repeat(201))).toThrow(InvalidInputError);
  });

  it("create() accepts max length", () => {
    const l = KeyLabel.create("a".repeat(200));
    expect(l.toString().length).toBe(200);
  });

  it("equals() compares value", () => {
    const a = KeyLabel.create("foo");
    const b = KeyLabel.create("foo");
    const c = KeyLabel.create("bar");
    expect(a.equals(b)).toBe(true);
    expect(a.equals(c)).toBe(false);
  });

  it("maxLength returns 200", () => {
    expect(KeyLabel.maxLength()).toBe(200);
  });
});
