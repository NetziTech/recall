import { describe, it, expect } from "vitest";

import { Timestamp } from "../../../../../src/shared/domain/value-objects/timestamp.ts";
import { InvalidInputError } from "../../../../../src/shared/domain/errors/invalid-input-error.ts";

describe("Timestamp", () => {
  describe("fromEpochMs", () => {
    it("accepts non-negative integers", () => {
      const t = Timestamp.fromEpochMs(0);
      expect(t.epochMs).toBe(0);
      expect(t.toEpochMs()).toBe(0);
    });

    it("accepts large integers", () => {
      const t = Timestamp.fromEpochMs(1_700_000_000_000);
      expect(t.toEpochMs()).toBe(1_700_000_000_000);
    });

    it("rejects NaN", () => {
      expect(() => Timestamp.fromEpochMs(Number.NaN)).toThrow(InvalidInputError);
    });

    it("rejects Infinity", () => {
      expect(() => Timestamp.fromEpochMs(Number.POSITIVE_INFINITY)).toThrow(
        InvalidInputError,
      );
    });

    it("rejects fractional", () => {
      expect(() => Timestamp.fromEpochMs(1.5)).toThrow(InvalidInputError);
    });

    it("rejects negative", () => {
      expect(() => Timestamp.fromEpochMs(-1)).toThrow(InvalidInputError);
    });
  });

  describe("fromDate", () => {
    it("converts a valid Date", () => {
      const d = new Date(1_700_000_000_000);
      const t = Timestamp.fromDate(d);
      expect(t.toEpochMs()).toBe(1_700_000_000_000);
    });

    it("rejects an invalid Date (NaN)", () => {
      const d = new Date("not-a-date");
      expect(() => Timestamp.fromDate(d)).toThrow(InvalidInputError);
    });
  });

  describe("now", () => {
    it("delegates to fromEpochMs", () => {
      const t = Timestamp.now(42);
      expect(t.toEpochMs()).toBe(42);
    });
  });

  describe("arithmetic", () => {
    const a = Timestamp.fromEpochMs(1000);
    const b = Timestamp.fromEpochMs(1500);

    it("diff is a - b", () => {
      expect(b.diff(a)).toBe(500);
      expect(a.diff(b)).toBe(-500);
    });

    it("absoluteDiff is non-negative", () => {
      expect(a.absoluteDiff(b)).toBe(500);
      expect(b.absoluteDiff(a)).toBe(500);
      expect(a.absoluteDiff(a)).toBe(0);
    });

    it("isAfter / isBefore / isSameInstantAs", () => {
      expect(b.isAfter(a)).toBe(true);
      expect(a.isAfter(b)).toBe(false);
      expect(a.isBefore(b)).toBe(true);
      expect(b.isBefore(a)).toBe(false);
      expect(a.isSameInstantAs(Timestamp.fromEpochMs(1000))).toBe(true);
      expect(a.isSameInstantAs(b)).toBe(false);
    });

    it("add returns a new Timestamp", () => {
      expect(a.add(500).toEpochMs()).toBe(1500);
      expect(a.toEpochMs()).toBe(1000); // unchanged
    });

    it("add rejects when result would go negative", () => {
      expect(() => a.add(-2000)).toThrow(InvalidInputError);
    });

    it("subtract", () => {
      expect(b.subtract(500).toEpochMs()).toBe(1000);
    });

    it("subtract rejects when result would go negative", () => {
      expect(() => a.subtract(2000)).toThrow(InvalidInputError);
    });
  });

  describe("conversion + equality", () => {
    it("toDate() round-trips epoch", () => {
      const t = Timestamp.fromEpochMs(1_700_000_000_000);
      expect(t.toDate().getTime()).toBe(1_700_000_000_000);
    });

    it("equals", () => {
      const a = Timestamp.fromEpochMs(123);
      const b = Timestamp.fromEpochMs(123);
      const c = Timestamp.fromEpochMs(124);
      expect(a.equals(b)).toBe(true);
      expect(a.equals(c)).toBe(false);
    });
  });
});
