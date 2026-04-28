import { describe, it, expect } from "vitest";

import { SystemClock } from "../../../../../src/shared/infrastructure/clock/system-clock.ts";
import { Timestamp } from "../../../../../src/shared/domain/value-objects/timestamp.ts";

describe("SystemClock", () => {
  it("now() returns a Timestamp close to wall clock", () => {
    const before = Date.now();
    const t = new SystemClock().now();
    const after = Date.now();
    expect(t).toBeInstanceOf(Timestamp);
    expect(t.toEpochMs()).toBeGreaterThanOrEqual(before);
    expect(t.toEpochMs()).toBeLessThanOrEqual(after);
  });

  it("nowMs() returns a number close to wall clock", () => {
    const before = Date.now();
    const ms = new SystemClock().nowMs();
    const after = Date.now();
    expect(ms).toBeGreaterThanOrEqual(before);
    expect(ms).toBeLessThanOrEqual(after);
  });

  it("two consecutive readings are non-decreasing within the same process", () => {
    const c = new SystemClock();
    const a = c.nowMs();
    const b = c.nowMs();
    expect(b).toBeGreaterThanOrEqual(a);
  });
});
