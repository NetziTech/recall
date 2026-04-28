import { describe, it, expect } from "vitest";

import { FakeClock } from "../../../../../src/shared/infrastructure/clock/fake-clock.ts";
import { Timestamp } from "../../../../../src/shared/domain/value-objects/timestamp.ts";
import { InvalidInputError } from "../../../../../src/shared/domain/errors/invalid-input-error.ts";

describe("FakeClock", () => {
  it("starts at the configured initialMs", () => {
    const c = new FakeClock({ initialMs: 1000 });
    expect(c.nowMs()).toBe(1000);
    expect(c.now()).toBeInstanceOf(Timestamp);
    expect(c.now().toEpochMs()).toBe(1000);
  });

  it("rejects non-integer initialMs (delegates to Timestamp.fromEpochMs)", () => {
    expect(() => new FakeClock({ initialMs: 1.5 })).toThrow(InvalidInputError);
  });

  it("rejects negative initialMs", () => {
    expect(() => new FakeClock({ initialMs: -1 })).toThrow(InvalidInputError);
  });

  it("advance() shifts forward and returns the new Timestamp", () => {
    const c = new FakeClock({ initialMs: 1000 });
    const t = c.advance(500);
    expect(t.toEpochMs()).toBe(1500);
    expect(c.nowMs()).toBe(1500);
  });

  it("advance(0) is a no-op", () => {
    const c = new FakeClock({ initialMs: 100 });
    expect(c.advance(0).toEpochMs()).toBe(100);
    expect(c.nowMs()).toBe(100);
  });

  it("advance(negative) refuses to go below zero", () => {
    const c = new FakeClock({ initialMs: 10 });
    expect(() => c.advance(-100)).toThrow(InvalidInputError);
  });

  it("set() jumps to an absolute instant", () => {
    const c = new FakeClock({ initialMs: 100 });
    const t = c.set(2000);
    expect(t.toEpochMs()).toBe(2000);
    expect(c.nowMs()).toBe(2000);
  });

  it("set() rejects negatives", () => {
    const c = new FakeClock({ initialMs: 100 });
    expect(() => c.set(-1)).toThrow(InvalidInputError);
  });

  it("monotonia: a sequence of advances preserves order", () => {
    const c = new FakeClock({ initialMs: 0 });
    const t1 = c.now();
    c.advance(100);
    const t2 = c.now();
    c.advance(100);
    const t3 = c.now();
    expect(t1.isBefore(t2)).toBe(true);
    expect(t2.isBefore(t3)).toBe(true);
  });
});
