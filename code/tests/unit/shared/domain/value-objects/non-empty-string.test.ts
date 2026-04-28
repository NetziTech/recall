import { describe, it, expect } from "vitest";

import { NonEmptyString } from "../../../../../src/shared/domain/value-objects/non-empty-string.ts";
import { InvalidInputError } from "../../../../../src/shared/domain/errors/invalid-input-error.ts";

describe("NonEmptyString", () => {
  it("trims and stores the canonical value", () => {
    const v = NonEmptyString.create("  hi  ");
    expect(v.toString()).toBe("hi");
    expect(v.length()).toBe(2);
  });

  it("rejects whitespace-only / empty input", () => {
    expect(() => NonEmptyString.create("")).toThrow(InvalidInputError);
    expect(() => NonEmptyString.create("   ")).toThrow(InvalidInputError);
  });

  it("uses default fieldName when not provided", () => {
    try {
      NonEmptyString.create("");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidInputError);
      expect((err as InvalidInputError).field).toBe("value");
    }
  });

  it("uses provided fieldName", () => {
    try {
      NonEmptyString.create("   ", "title");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidInputError);
      expect((err as InvalidInputError).field).toBe("title");
    }
  });

  describe("equals", () => {
    it("self-equal", () => {
      const v = NonEmptyString.create("foo");
      expect(v.equals(v)).toBe(true);
    });

    it("same canonical value across distinct instances", () => {
      const a = NonEmptyString.create("foo ");
      const b = NonEmptyString.create("foo");
      expect(a.equals(b)).toBe(true);
    });

    it("different value", () => {
      expect(
        NonEmptyString.create("foo").equals(NonEmptyString.create("bar")),
      ).toBe(false);
    });

    it("different subclass type returns false", () => {
      class A extends NonEmptyString {
        public static override create(raw: string): A {
          return new A(raw.trim());
        }
        // expose constructor through static create
        public constructor(value: string) {
          super(value);
        }
      }
      const baseA = NonEmptyString.create("hi");
      const subA = A.create("hi");
      expect(baseA.equals(subA)).toBe(false);
    });
  });
});
