import { describe, it, expect } from "vitest";

import { Tokens } from "../../../../../src/shared/domain/value-objects/tokens.ts";
import { InvalidInputError } from "../../../../../src/shared/domain/errors/invalid-input-error.ts";
import { InvariantViolationError } from "../../../../../src/shared/domain/errors/invariant-violation-error.ts";

describe("Tokens", () => {
  describe("factories", () => {
    it("zero", () => {
      expect(Tokens.zero().count).toBe(0);
      expect(Tokens.zero().isZero()).toBe(true);
    });

    it("of accepts non-negative integer", () => {
      expect(Tokens.of(42).count).toBe(42);
    });

    it("of rejects NaN", () => {
      expect(() => Tokens.of(Number.NaN)).toThrow(InvalidInputError);
    });

    it("of rejects fractional", () => {
      expect(() => Tokens.of(1.5)).toThrow(InvalidInputError);
    });

    it("of rejects negative", () => {
      expect(() => Tokens.of(-1)).toThrow(InvalidInputError);
    });

    it("of rejects Infinity", () => {
      expect(() => Tokens.of(Number.POSITIVE_INFINITY)).toThrow(InvalidInputError);
    });
  });

  describe("arithmetic", () => {
    it("add", () => {
      expect(Tokens.of(3).add(Tokens.of(4)).count).toBe(7);
    });

    it("subtract success", () => {
      expect(Tokens.of(10).subtract(Tokens.of(3)).count).toBe(7);
    });

    it("subtract refuses negative result", () => {
      expect(() => Tokens.of(2).subtract(Tokens.of(5))).toThrow(
        InvariantViolationError,
      );
    });
  });

  describe("comparators", () => {
    const a = Tokens.of(3);
    const b = Tokens.of(5);
    const c = Tokens.of(3);

    it("gte / gt", () => {
      expect(b.gte(a)).toBe(true);
      expect(a.gte(c)).toBe(true);
      expect(a.gt(c)).toBe(false);
      expect(b.gt(a)).toBe(true);
    });

    it("lte / lt", () => {
      expect(a.lte(b)).toBe(true);
      expect(a.lte(c)).toBe(true);
      expect(a.lt(c)).toBe(false);
      expect(a.lt(b)).toBe(true);
    });

    it("isZero / equals / toNumber", () => {
      expect(Tokens.zero().isZero()).toBe(true);
      expect(a.isZero()).toBe(false);
      expect(a.equals(c)).toBe(true);
      expect(a.equals(b)).toBe(false);
      expect(a.toNumber()).toBe(3);
    });
  });
});
