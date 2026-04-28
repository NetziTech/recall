import { describe, it, expect } from "vitest";
import { ToolRegistration } from "../../../../src/modules/mcp-server/domain/aggregates/tool-registration.ts";
import { ToolName } from "../../../../src/modules/mcp-server/domain/value-objects/tool-name.ts";
import { ToolDescription } from "../../../../src/modules/mcp-server/domain/value-objects/tool-description.ts";
import { LastInvokedAt } from "../../../../src/modules/mcp-server/domain/value-objects/last-invoked-at.ts";
import { InvocationCount } from "../../../../src/modules/mcp-server/domain/value-objects/invocation-count.ts";
import { Timestamp } from "../../../../src/shared/domain/value-objects/timestamp.ts";
import { InvariantViolationError } from "../../../../src/shared/domain/errors/invariant-violation-error.ts";

const ts = (epochMs = 1): Timestamp => Timestamp.fromEpochMs(epochMs);

const buildRegistered = (): ToolRegistration =>
  ToolRegistration.register({
    name: ToolName.init(),
    description: ToolDescription.create("init the workspace"),
    occurredAt: ts(1),
  });

describe("ToolRegistration", () => {
  it("register starts enabled, count 0, never invoked", () => {
    const r = buildRegistered();
    expect(r.isEnabled()).toBe(true);
    expect(r.getInvocationCount().value).toBe(0);
    expect(r.getLastInvokedAt().kind).toBe("never");
    const events = r.pullEvents();
    expect(events[0]?.eventName).toBe("mcp-server.tool-registered");
  });

  it("rehydrate emits no event", () => {
    const r = ToolRegistration.rehydrate({
      name: ToolName.recall(),
      description: ToolDescription.create("recall"),
      enabled: true,
      registeredAt: ts(1),
      lastInvokedAt: LastInvokedAt.never(),
      invocationCount: InvocationCount.zero(),
    });
    expect(r.pullEvents().length).toBe(0);
  });

  it("disable + enable transitions emit events", () => {
    const r = buildRegistered();
    r.pullEvents();
    r.disable({ occurredAt: ts(2) });
    expect(r.isEnabled()).toBe(false);
    expect(r.isDisabled()).toBe(true);
    const e1 = r.pullEvents();
    expect(e1[0]?.eventName).toBe("mcp-server.tool-disabled");
    r.enable({ occurredAt: ts(3) });
    expect(r.isEnabled()).toBe(true);
    const e2 = r.pullEvents();
    expect(e2[0]?.eventName).toBe("mcp-server.tool-enabled");
  });

  it("enable rejects already-enabled", () => {
    const r = buildRegistered();
    expect(() => r.enable({ occurredAt: ts(2) })).toThrow(
      InvariantViolationError,
    );
  });

  it("disable rejects already-disabled", () => {
    const r = buildRegistered();
    r.disable({ occurredAt: ts(2) });
    expect(() => r.disable({ occurredAt: ts(3) })).toThrow(
      InvariantViolationError,
    );
  });

  it("recordInvocation bumps count and refreshes lastInvokedAt", () => {
    const r = buildRegistered();
    r.recordInvocation({ occurredAt: ts(2) });
    expect(r.getInvocationCount().value).toBe(1);
    expect(r.getLastInvokedAt().kind).toBe("at");
    expect(r.getLastInvokedAt().at?.epochMs).toBe(2);
  });

  it("recordInvocation emits no event (per design)", () => {
    const r = buildRegistered();
    r.pullEvents(); // drain register
    r.recordInvocation({ occurredAt: ts(2) });
    expect(r.pullEvents().length).toBe(0);
  });

  it("recordInvocation works even if disabled (audit requires recording attempts)", () => {
    const r = buildRegistered();
    r.disable({ occurredAt: ts(2) });
    r.pullEvents();
    r.recordInvocation({ occurredAt: ts(3) });
    expect(r.getInvocationCount().value).toBe(1);
  });

  it("getName / getDescription / getRegisteredAt", () => {
    const r = buildRegistered();
    expect(r.getName().equals(ToolName.init())).toBe(true);
    expect(r.getDescription().toString()).toBe("init the workspace");
    expect(r.getRegisteredAt().epochMs).toBe(1);
  });

  it("pullEvents drains and returns frozen", () => {
    const r = buildRegistered();
    r.pullEvents();
    const empty = r.pullEvents();
    expect(empty.length).toBe(0);
    expect(Object.isFrozen(empty)).toBe(true);
  });
});
