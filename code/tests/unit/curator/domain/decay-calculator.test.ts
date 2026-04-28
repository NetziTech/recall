import { describe, expect, it } from "vitest";
import { DecayCalculator } from "../../../../src/modules/curator/domain/services/decay-calculator.ts";
import { MemoryEntryKind } from "../../../../src/modules/curator/domain/value-objects/memory-entry-kind.ts";
import { LearningSeverity } from "../../../../src/modules/memory/domain/value-objects/learning-severity.ts";
import { Confidence } from "../../../../src/shared/domain/value-objects/confidence.ts";
import { InvalidInputError } from "../../../../src/shared/domain/errors/invalid-input-error.ts";

describe("DecayCalculator.newConfidence", () => {
  describe("short-circuits", () => {
    it("returns the input unchanged when factor is unity (task)", () => {
      const out = DecayCalculator.newConfidence({
        current: Confidence.of(0.5),
        daysSinceLastUsed: 100,
        kind: MemoryEntryKind.task(),
        severity: null,
      });
      expect(out.toNumber()).toBe(0.5);
    });

    it("returns the input unchanged when factor is unity (learning critical)", () => {
      const out = DecayCalculator.newConfidence({
        current: Confidence.of(0.7),
        daysSinceLastUsed: 9999,
        kind: MemoryEntryKind.learning(),
        severity: LearningSeverity.critical(),
      });
      expect(out.toNumber()).toBe(0.7);
    });

    it("returns the input unchanged when daysSinceLastUsed === 0", () => {
      const out = DecayCalculator.newConfidence({
        current: Confidence.of(0.8),
        daysSinceLastUsed: 0,
        kind: MemoryEntryKind.decision(),
        severity: null,
      });
      expect(out.toNumber()).toBe(0.8);
    });
  });

  describe("decay over time", () => {
    it("applies geometric decay for decisions over 365 days", () => {
      const out = DecayCalculator.newConfidence({
        current: Confidence.of(1),
        daysSinceLastUsed: 365,
        kind: MemoryEntryKind.decision(),
        severity: null,
      });
      // 0.999888^365 ≈ 0.96
      expect(out.toNumber()).toBeGreaterThan(0.95);
      expect(out.toNumber()).toBeLessThan(0.97);
    });

    it("applies aggressive decay for turns over 14 days", () => {
      const out = DecayCalculator.newConfidence({
        current: Confidence.of(1),
        daysSinceLastUsed: 14,
        kind: MemoryEntryKind.turn(),
        severity: null,
      });
      // 0.988459^14 ≈ 0.85
      expect(out.toNumber()).toBeGreaterThan(0.84);
      expect(out.toNumber()).toBeLessThan(0.87);
    });

    it("learning warnings decay slower than tips over the same window", () => {
      const tip = DecayCalculator.newConfidence({
        current: Confidence.of(1),
        daysSinceLastUsed: 30,
        kind: MemoryEntryKind.learning(),
        severity: LearningSeverity.tip(),
      });
      const warning = DecayCalculator.newConfidence({
        current: Confidence.of(1),
        daysSinceLastUsed: 30,
        kind: MemoryEntryKind.learning(),
        severity: LearningSeverity.warning(),
      });
      expect(warning.toNumber()).toBeGreaterThan(tip.toNumber());
    });

    it("decay reduces confidence to 0 only at the limit", () => {
      const out = DecayCalculator.newConfidence({
        current: Confidence.of(0),
        daysSinceLastUsed: 100,
        kind: MemoryEntryKind.decision(),
        severity: null,
      });
      expect(out.toNumber()).toBe(0);
    });
  });

  describe("validation", () => {
    it("rejects non-finite daysSinceLastUsed", () => {
      expect(() =>
        DecayCalculator.newConfidence({
          current: Confidence.of(1),
          daysSinceLastUsed: Number.POSITIVE_INFINITY,
          kind: MemoryEntryKind.decision(),
          severity: null,
        }),
      ).toThrow(InvalidInputError);
      expect(() =>
        DecayCalculator.newConfidence({
          current: Confidence.of(1),
          daysSinceLastUsed: Number.NaN,
          kind: MemoryEntryKind.decision(),
          severity: null,
        }),
      ).toThrow(InvalidInputError);
    });

    it("rejects negative daysSinceLastUsed", () => {
      expect(() =>
        DecayCalculator.newConfidence({
          current: Confidence.of(1),
          daysSinceLastUsed: -1,
          kind: MemoryEntryKind.decision(),
          severity: null,
        }),
      ).toThrow(InvalidInputError);
    });

    it("accepts fractional days", () => {
      const out = DecayCalculator.newConfidence({
        current: Confidence.of(1),
        daysSinceLastUsed: 0.5,
        kind: MemoryEntryKind.decision(),
        severity: null,
      });
      expect(out.toNumber()).toBeLessThan(1);
      expect(out.toNumber()).toBeGreaterThan(0.999);
    });
  });
});
