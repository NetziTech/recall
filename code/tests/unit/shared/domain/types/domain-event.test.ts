import { describe, it, expect } from "vitest";

import type { DomainEvent } from "../../../../../src/shared/domain/types/domain-event.ts";
import { Timestamp } from "../../../../../src/shared/domain/value-objects/timestamp.ts";

describe("DomainEvent", () => {
  it("structural shape: requires occurredAt and eventName", () => {
    const e: DomainEvent = {
      occurredAt: Timestamp.fromEpochMs(0),
      eventName: "shared.test-event-fired",
    };
    expect(e.occurredAt).toBeInstanceOf(Timestamp);
    expect(e.eventName).toBe("shared.test-event-fired");
  });
});
