import { describe, it, expect, expectTypeOf } from "vitest";

import type { Brand } from "../../../../../src/shared/domain/types/branded.ts";

describe("Brand", () => {
  it("is a phantom type with no runtime effect", () => {
    type FooId = Brand<string, "Foo">;
    const x = "abc" as FooId;
    // Runtime: still a string.
    expect(typeof x).toBe("string");
    expect(x).toBe("abc");
  });

  it("brands are not assignable across distinct labels at compile time", () => {
    type FooId = Brand<string, "Foo">;
    type BarId = Brand<string, "Bar">;
    expectTypeOf<FooId>().not.toEqualTypeOf<BarId>();
  });
});
