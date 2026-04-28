import { describe, expect, it } from "vitest";
import { DecayFactor } from "../../../../src/modules/curator/domain/value-objects/decay-factor.ts";
import { MemoryEntryKind } from "../../../../src/modules/curator/domain/value-objects/memory-entry-kind.ts";
import { LearningSeverity } from "../../../../src/modules/memory/domain/value-objects/learning-severity.ts";
import { InvalidDecayFactorError } from "../../../../src/modules/curator/domain/errors/invalid-decay-factor-error.ts";

describe("DecayFactor", () => {
  describe("of", () => {
    it("accepts a value in (0, 1]", () => {
      expect(DecayFactor.of(0.5).toNumber()).toBe(0.5);
      expect(DecayFactor.of(1).toNumber()).toBe(1);
      expect(DecayFactor.of(0.0001).toNumber()).toBe(0.0001);
    });

    it("rejects zero", () => {
      expect(() => DecayFactor.of(0)).toThrow(InvalidDecayFactorError);
    });

    it("rejects negative values", () => {
      expect(() => DecayFactor.of(-0.5)).toThrow(InvalidDecayFactorError);
    });

    it("rejects values above 1", () => {
      expect(() => DecayFactor.of(1.0001)).toThrow(InvalidDecayFactorError);
    });

    it("rejects non-finite values", () => {
      expect(() => DecayFactor.of(Number.NaN)).toThrow(InvalidDecayFactorError);
      expect(() => DecayFactor.of(Number.POSITIVE_INFINITY)).toThrow(
        InvalidDecayFactorError,
      );
      expect(() => DecayFactor.of(Number.NEGATIVE_INFINITY)).toThrow(
        InvalidDecayFactorError,
      );
    });
  });

  describe("forKind", () => {
    it("returns the per-day default for decision", () => {
      const f = DecayFactor.forKind(MemoryEntryKind.decision(), null);
      expect(f.toNumber()).toBe(0.999888);
    });

    it("returns the per-day default for entity", () => {
      const f = DecayFactor.forKind(MemoryEntryKind.entity(), null);
      expect(f.toNumber()).toBe(0.998292);
    });

    it("returns unity for task (no decay)", () => {
      const f = DecayFactor.forKind(MemoryEntryKind.task(), null);
      expect(f.toNumber()).toBe(1);
      expect(f.isUnity()).toBe(true);
    });

    it("returns the per-day default for turn", () => {
      const f = DecayFactor.forKind(MemoryEntryKind.turn(), null);
      expect(f.toNumber()).toBe(0.988459);
    });

    it("learning + tip uses tip override", () => {
      const f = DecayFactor.forKind(
        MemoryEntryKind.learning(),
        LearningSeverity.tip(),
      );
      expect(f.toNumber()).toBe(0.998292);
    });

    it("learning + warning uses warning override (slower decay)", () => {
      const f = DecayFactor.forKind(
        MemoryEntryKind.learning(),
        LearningSeverity.warning(),
      );
      expect(f.toNumber()).toBe(0.999492);
    });

    it("learning + critical is unity (no decay)", () => {
      const f = DecayFactor.forKind(
        MemoryEntryKind.learning(),
        LearningSeverity.critical(),
      );
      expect(f.toNumber()).toBe(1);
      expect(f.isUnity()).toBe(true);
    });

    it("learning + null severity falls back to kind-level default", () => {
      const f = DecayFactor.forKind(MemoryEntryKind.learning(), null);
      expect(f.toNumber()).toBe(0.998292);
    });

    it("non-learning kind ignores severity", () => {
      const f = DecayFactor.forKind(
        MemoryEntryKind.decision(),
        LearningSeverity.critical(),
      );
      expect(f.toNumber()).toBe(0.999888);
    });
  });

  describe("unity", () => {
    it("creates a no-decay factor", () => {
      const f = DecayFactor.unity();
      expect(f.toNumber()).toBe(1);
      expect(f.isUnity()).toBe(true);
    });
  });

  describe("isUnity", () => {
    it("returns true for value === 1", () => {
      expect(DecayFactor.of(1).isUnity()).toBe(true);
    });

    it("returns false for any value < 1", () => {
      expect(DecayFactor.of(0.999999).isUnity()).toBe(false);
    });
  });

  describe("equals", () => {
    it("compares by numeric value", () => {
      expect(DecayFactor.of(0.5).equals(DecayFactor.of(0.5))).toBe(true);
      expect(DecayFactor.of(0.5).equals(DecayFactor.of(0.6))).toBe(false);
    });
  });

  describe("calibration: matches the spec's per-year decay", () => {
    it("decision factor^365 ≈ 0.96 (active, 90d → 0.99)", () => {
      // The spec says decision (active) loses to 0.99 every 90 days.
      // Over 365 days: 0.99^(365/90) ≈ 0.961.
      const factor = DecayFactor.forKind(MemoryEntryKind.decision(), null);
      const yearly = Math.pow(factor.toNumber(), 365);
      expect(yearly).toBeGreaterThan(0.95);
      expect(yearly).toBeLessThan(0.97);
    });

    it("learning(tip) factor^365 ≈ 0.535 (matches the docs/05 'x 0.54 al año')", () => {
      const factor = DecayFactor.forKind(
        MemoryEntryKind.learning(),
        LearningSeverity.tip(),
      );
      const yearly = Math.pow(factor.toNumber(), 365);
      expect(yearly).toBeGreaterThan(0.52);
      expect(yearly).toBeLessThan(0.55);
    });
  });
});
