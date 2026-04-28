import { describe, expect, it } from "vitest";
import { SessionContextHelper } from "../../../../src/modules/memory/application/use-cases/session-context-helper.ts";
import { Session } from "../../../../src/modules/memory/domain/aggregates/session.ts";
import { SessionId } from "../../../../src/modules/memory/domain/value-objects/session-id.ts";
import type { SessionRepository } from "../../../../src/modules/memory/domain/repositories/session-repository.ts";
import type { WorkspaceId } from "../../../../src/shared/domain/value-objects/workspace-id.ts";
import { FakeClock } from "../../../../src/shared/infrastructure/clock/fake-clock.ts";
import { FakeIdGenerator } from "../../../../src/shared/infrastructure/id-generator/fake-id-generator.ts";
import { SessionStarted } from "../../../../src/modules/memory/domain/events/session-started.ts";
import { SessionEnded } from "../../../../src/modules/memory/domain/events/session-ended.ts";
import {
  ANCHOR_TIME_MS,
  FIXED_SESSION_UUID,
  makeTimestamp,
  makeWorkspaceId,
} from "../../../helpers/factories.ts";
import { RecordingEventPublisher } from "../../../helpers/test-doubles.ts";

class InMemorySessionRepository implements SessionRepository {
  private readonly byId = new Map<string, Session>();
  // Maps workspaceId.toString() -> sessionId of the current open session
  private readonly currentByWorkspace = new Map<string, string>();

  public findById(id: SessionId): Promise<Session | null> {
    return Promise.resolve(this.byId.get(id.toString()) ?? null);
  }

  public save(session: Session): Promise<void> {
    this.byId.set(session.getId().toString(), session);
    const ws = session.getWorkspaceId().toString();
    if (session.isEnded()) {
      const cur = this.currentByWorkspace.get(ws);
      if (cur === session.getId().toString()) {
        this.currentByWorkspace.delete(ws);
      }
    } else {
      this.currentByWorkspace.set(ws, session.getId().toString());
    }
    return Promise.resolve();
  }

  public findCurrentByWorkspace(
    workspaceId: WorkspaceId,
  ): Promise<Session | null> {
    const sid = this.currentByWorkspace.get(workspaceId.toString());
    if (sid === undefined) return Promise.resolve(null);
    return Promise.resolve(this.byId.get(sid) ?? null);
  }

  public findAllByWorkspace(
    workspaceId: WorkspaceId,
  ): Promise<readonly Session[]> {
    const out: Session[] = [];
    for (const s of this.byId.values()) {
      if (s.getWorkspaceId().equals(workspaceId)) out.push(s);
    }
    return Promise.resolve(out);
  }
}

function makeHelper() {
  const repo = new InMemorySessionRepository();
  const clock = new FakeClock({ initialMs: ANCHOR_TIME_MS });
  const idGen = new FakeIdGenerator({
    sequence: [
      FIXED_SESSION_UUID,
      "01952f3c-2222-7000-8000-aaaaaaaaaaaa",
      "01952f3c-2222-7000-8000-bbbbbbbbbbbb",
    ],
  });
  const events = new RecordingEventPublisher();
  const helper = new SessionContextHelper(repo, clock, idGen, events);
  return { helper, repo, clock, events };
}

describe("SessionContextHelper.acquire", () => {
  it("starts a fresh session when none exists (opened=true)", async () => {
    const { helper, events } = makeHelper();
    const result = await helper.acquire({
      workspaceId: makeWorkspaceId(),
      intent: null,
    });
    expect(result.opened).toBe(true);
    expect(result.session.getId().toString()).toBe(FIXED_SESSION_UUID);
    expect(result.session.isEnded()).toBe(false);
    expect(events.published()).toHaveLength(1);
    expect(events.published()[0]).toBeInstanceOf(SessionStarted);
  });

  it("returns the existing session when active (opened=false)", async () => {
    const { helper, clock, events } = makeHelper();
    const ws = makeWorkspaceId();
    const first = await helper.acquire({ workspaceId: ws, intent: null });
    events.clear();
    clock.advance(10 * 60 * 1000); // 10 minutes — well within idle window
    const second = await helper.acquire({ workspaceId: ws, intent: null });
    expect(second.opened).toBe(false);
    expect(second.session.getId().toString()).toBe(
      first.session.getId().toString(),
    );
    expect(events.published()).toHaveLength(0);
  });

  it("rotates the session when idle > 30 min", async () => {
    const { helper, clock, events } = makeHelper();
    const ws = makeWorkspaceId();
    const first = await helper.acquire({ workspaceId: ws, intent: null });
    events.clear();
    clock.advance(31 * 60 * 1000); // 31 minutes — past the threshold
    const second = await helper.acquire({ workspaceId: ws, intent: null });
    expect(second.opened).toBe(true);
    expect(second.session.getId().toString()).not.toBe(
      first.session.getId().toString(),
    );
    // Expect: SessionEnded for the previous + SessionStarted for the new
    const published = events.published();
    expect(published.some((e) => e instanceof SessionEnded)).toBe(true);
    expect(published.some((e) => e instanceof SessionStarted)).toBe(true);
    // The rotated session links resumedFrom to the previous one
    expect(second.session.getResumedFrom()?.toString()).toBe(
      first.session.getId().toString(),
    );
  });

  it("propagates intent to the freshly opened session", async () => {
    const { helper } = makeHelper();
    const result = await helper.acquire({
      workspaceId: makeWorkspaceId(),
      intent: "Build login flow",
    });
    expect(result.session.getIntent()?.toString()).toBe("Build login flow");
  });

  it("ignores empty/whitespace-only intent (no SessionIntent assigned)", async () => {
    const { helper } = makeHelper();
    const result = await helper.acquire({
      workspaceId: makeWorkspaceId(),
      intent: "   ",
    });
    expect(result.session.getIntent()).toBe(null);
  });
});

describe("SessionContextHelper.findActive", () => {
  it("returns null when no session exists", async () => {
    const { helper } = makeHelper();
    const found = await helper.findActive(makeWorkspaceId());
    expect(found).toBe(null);
  });

  it("returns the current session without rotating", async () => {
    const { helper, clock } = makeHelper();
    const ws = makeWorkspaceId();
    await helper.acquire({ workspaceId: ws, intent: null });
    clock.advance(31 * 60 * 1000); // past idle
    const found = await helper.findActive(ws);
    // findActive does NOT rotate — it returns whatever is there.
    expect(found).not.toBe(null);
    // (Even though the session is idle, findActive returns it as-is.)
    expect(found?.isIdle(makeTimestamp(ANCHOR_TIME_MS + 31 * 60 * 1000)))
      .toBe(true);
  });
});
