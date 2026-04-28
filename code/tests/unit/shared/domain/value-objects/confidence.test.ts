import { describe, it, expect } from "vitest";

import { Confidence } from "../../../../../src/shared/domain/value-objects/confidence.ts";
import { InvalidInputError } from "../../../../../src/shared/domain/errors/invalid-input-error.ts";

describe("Confidence", () => {
  describe("factories", () => {
    it("full() = 1", () => {
      expect(Confidence.full().value).toBe(1);
    });

    it("none() = 0", () => {
      expect(Confidence.none().value).toBe(0);
    });

    it("of() accepts the closed interval", () => {
      expect(Confidence.of(0).value).toBe(0);
      expect(Confidence.of(0.5).value).toBe(0.5);
      expect(Confidence.of(1).value).toBe(1);
    });

    it("of() rejects NaN", () => {
      expect(() => Confidence.of(Number.NaN)).toThrow(InvalidInputError);
    });

    it("of() rejects out-of-range", () => {
      expect(() => Confidence.of(-0.01)).toThrow(InvalidInputError);
      expect(() => Confidence.of(1.01)).toThrow(InvalidInputError);
    });
  });

  describe("decay", () => {
    it("multiplies by factor", () => {
      const c = Confidence.of(0.8);
      expect(c.decay(0.5).value).toBeCloseTo(0.4, 10);
    });

    it("decay(1) is no-op", () => {
      const c = Confidence.of(0.7);
      expect(c.decay(1).value).toBe(0.7);
    });

    it("decay(0) collapses to zero", () => {
      expect(Confidence.full().decay(0).value).toBe(0);
    });

    it("rejects NaN factor", () => {
      expect(() => Confidence.full().decay(Number.NaN)).toThrow(InvalidInputError);
    });

    it("rejects out-of-range factor", () => {
      expect(() => Confidence.full().decay(-0.1)).toThrow(InvalidInputError);
      expect(() => Confidence.full().decay(1.1)).toThrow(InvalidInputError);
    });
  });

  describe("boost", () => {
    it("adds and clamps to 1", () => {
      expect(Confidence.of(0.4).boost(0.3).value).toBeCloseTo(0.7, 10);
      expect(Confidence.of(0.9).boost(0.3).value).toBe(1);
    });

    it("zero boost is no-op", () => {
      expect(Confidence.of(0.5).boost(0).value).toBe(0.5);
    });

    it("rejects NaN amount", () => {
      expect(() => Confidence.full().boost(Number.NaN)).toThrow(InvalidInputError);
    });

    it("rejects negative amount", () => {
      expect(() => Confidence.full().boost(-0.1)).toThrow(InvalidInputError);
    });
  });

  describe("comparators / equality", () => {
    const low = Confidence.of(0.3);
    const high = Confidence.of(0.7);
    const dup = Confidence.of(0.3);

    it("isAboveOrEqual", () => {
      expect(high.isAboveOrEqual(low)).toBe(true);
      expect(low.isAboveOrEqual(low)).toBe(true);
      expect(low.isAboveOrEqual(high)).toBe(false);
    });

    it("isBelow", () => {
      expect(low.isBelow(high)).toBe(true);
      expect(high.isBelow(low)).toBe(false);
      expect(low.isBelow(low)).toBe(false);
    });

    it("equals + toNumber", () => {
      expect(low.equals(dup)).toBe(true);
      expect(low.equals(high)).toBe(false);
      expect(low.toNumber()).toBe(0.3);
    });
  });
});
