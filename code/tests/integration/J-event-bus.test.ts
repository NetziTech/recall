/**
 * Integration test — Flow J: EventBus subscription end-to-end.
 *
 * Verifies the cross-module bus wired in
 * `composition/event-bus/in-memory-event-bus.ts`:
 *
 *   - A subscriber registered against a specific event name receives
 *     ONLY that event.
 *   - A `subscribeAll` subscriber receives every event.
 *   - The bus survives subscriber failures (errors in one handler do
 *     not propagate to the other handlers).
 *   - `unsubscribe()` releases the slot.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Tags } from "../../src/shared/domain/value-objects/tags.ts";
import { Scope } from "../../src/modules/memory/domain/value-objects/scope.ts";
import type { DomainEvent } from "../../src/shared/domain/types/domain-event.ts";
import { buildTestContainer, type TestContainer } from "./_helpers/build-test-container.ts";

describe("integration / J / EventBus — cross-module subscription", () => {
  let ctx: TestContainer;

  beforeEach(async () => {
    ctx = await buildTestContainer();
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it("delivers events to a name-bound subscriber", async () => {
    const decisionEvents: DomainEvent[] = [];
    ctx.eventBus.subscribe("memory.decision-recorded", (e) => {
      decisionEvents.push(e);
    });

    await ctx.memory.recordDecision.record({
      workspaceId: ctx.workspaceId,
      sessionId: null,
      title: "Bus integration",
      rationale: "Emit a domain event end-to-end.",
      tags: Tags.empty(),
      scope: Scope.project(),
    });

    expect(decisionEvents.length).toBe(1);
    expect(decisionEvents[0]?.eventName).toBe("memory.decision-recorded");
  });

  it("does NOT deliver other event names to a name-bound subscriber", async () => {
    const decisionEvents: DomainEvent[] = [];
    ctx.eventBus.subscribe("memory.decision-recorded", (e) => {
      decisionEvents.push(e);
    });

    await ctx.memory.recordLearning.record({
      workspaceId: ctx.workspaceId,
      text: "An unrelated learning.",
      severity: null,
      tags: Tags.empty(),
      scope: Scope.project(),
    });

    expect(decisionEvents).toHaveLength(0);
  });

  it("delivers EVERY event to a `subscribeAll` subscriber", async () => {
    const allEvents: DomainEvent[] = [];
    ctx.eventBus.subscribeAll((e) => {
      allEvents.push(e);
    });

    await ctx.memory.recordDecision.record({
      workspaceId: ctx.workspaceId,
      sessionId: null,
      title: "All subscribers",
      rationale: "Decisions go here.",
      tags: Tags.empty(),
      scope: Scope.project(),
    });
    await ctx.memory.recordLearning.record({
      workspaceId: ctx.workspaceId,
      text: "Learnings too.",
      severity: null,
      tags: Tags.empty(),
      scope: Scope.project(),
    });

    expect(allEvents.length).toBeGreaterThanOrEqual(2);
    const names = allEvents.map((e) => e.eventName);
    expect(names).toContain("memory.decision-recorded");
    expect(names).toContain("memory.learning-registered");
  });

  it("isolates subscriber failures (one throwing handler does not silence the others)", async () => {
    const goodEvents: DomainEvent[] = [];
    ctx.eventBus.subscribe("memory.decision-recorded", () => {
      throw new Error("subscriber bug");
    });
    ctx.eventBus.subscribe("memory.decision-recorded", (e) => {
      goodEvents.push(e);
    });

    await ctx.memory.recordDecision.record({
      workspaceId: ctx.workspaceId,
      sessionId: null,
      title: "Resilient bus",
      rationale: "Bad subscribers do not poison the well.",
      tags: Tags.empty(),
      scope: Scope.project(),
    });
    expect(goodEvents.length).toBe(1);
  });

  it("unsubscribe() releases the slot", async () => {
    const events: DomainEvent[] = [];
    const sub = ctx.eventBus.subscribe("memory.decision-recorded", (e) => {
      events.push(e);
    });

    await ctx.memory.recordDecision.record({
      workspaceId: ctx.workspaceId,
      sessionId: null,
      title: "First",
      rationale: "Counted.",
      tags: Tags.empty(),
      scope: Scope.project(),
    });
    expect(events.length).toBe(1);

    sub.unsubscribe();

    await ctx.memory.recordDecision.record({
      workspaceId: ctx.workspaceId,
      sessionId: null,
      title: "Second",
      rationale: "Not counted (subscriber gone).",
      tags: Tags.empty(),
      scope: Scope.project(),
    });
    expect(events.length).toBe(1);
  });
});
