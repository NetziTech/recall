import { describe, it, expect } from "vitest";

import { CommandArgs } from "../../../../../src/modules/cli/domain/value-objects/command-args.ts";

describe("CommandArgs", () => {
  it("of() wraps an arbitrary payload", () => {
    const obj = { a: 1 };
    const a = CommandArgs.of(obj);
    expect(a.raw()).toBe(obj);
  });

  it("empty() yields null payload", () => {
    expect(CommandArgs.empty().raw()).toBeNull();
  });

  it("equals: reference equality on payload", () => {
    const obj = { x: 1 };
    expect(CommandArgs.of(obj).equals(CommandArgs.of(obj))).toBe(true);
    // Two distinct objects with same content are NOT equal.
    expect(CommandArgs.of({ x: 1 }).equals(CommandArgs.of({ x: 1 }))).toBe(false);
    expect(CommandArgs.empty().equals(CommandArgs.empty())).toBe(true);
  });
});
