import { describe, expect, it } from "vitest";
import { StartSessionUseCase } from "../../../../src/modules/memory/application/use-cases/start-session.use-case.ts";
import { EndSessionUseCase } from "../../../../src/modules/memory/application/use-cases/end-session.use-case.ts";
import { Session } from "../../../../src/modules/memory/domain/aggregates/session.ts";
import type { SessionRepository } from "../../../../src/modules/memory/domain/repositories/session-repository.ts";
import { SessionId } from "../../../../src/modules/memory/domain/value-objects/session-id.ts";
import type { WorkspaceId } from "../../../../src/shared/domain/value-objects/workspace-id.ts";
import { FakeClock } from "../../../../src/shared/infrastructure/clock/fake-clock.ts";
import { FakeIdGenerator } from "../../../../src/shared/infrastructure/id-generator/fake-id-generator.ts";
import {
  ANCHOR_TIME_MS,
  FIXED_SESSION_UUID,
  makeWorkspaceId,
} from "../../../helpers/factories.ts";
import { RecordingEventPublisher } from "../../../helpers/test-doubles.ts";

class InMemorySessionRepo implements SessionRepository {
  private readonly byId = new Map<string, Session>();
  private readonly currentByWs = new Map<string, string>();

  public findById(id: SessionId): Promise<Session | null> {
    return Promise.resolve(this.byId.get(id.toString()) ?? null);
  }

  public save(session: Session): Promise<void> {
    this.byId.set(session.getId().toString(), session);
    const ws = session.getWorkspaceId().toString();
    if (session.isEnded()) {
      const cur = this.currentByWs.get(ws);
      if (cur === session.getId().toString()) {
        this.currentByWs.delete(ws);
      }
    } else {
      this.currentByWs.set(ws, session.getId().toString());
    }
    return Promise.resolve();
  }

  public findCurrentByWorkspace(
    workspaceId: WorkspaceId,
  ): Promise<Session | null> {
    const sid = this.currentByWs.get(workspaceId.toString());
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

const SECOND_SESSION_UUID = "01952f3c-2222-7000-8000-aaaaaaaaaaaa";

describe("StartSessionUseCase", () => {
  it("opens a fresh session when none exists", async () => {
    const repo = new InMemorySessionRepo();
    const clock = new FakeClock({ initialMs: ANCHOR_TIME_MS });
    const idGen = new FakeIdGenerator({ sequence: [FIXED_SESSION_UUID] });
    const events = new RecordingEventPublisher();
    const useCase = new StartSessionUseCase(repo, idGen, clock, events);
    const result = await useCase.start({
      workspaceId: makeWorkspaceId(),
      intent: null,
    });
    expect(result.sessionId.toString()).toBe(FIXED_SESSION_UUID);
    expect(result.previousSessionClosed).toBe(false);
  });

  it("returns existing session when active and not idle (no rotation)", async () => {
    const repo = new InMemorySessionRepo();
    const clock = new FakeClock({ initialMs: ANCHOR_TIME_MS });
    const idGen = new FakeIdGenerator({
      sequence: [FIXED_SESSION_UUID, SECOND_SESSION_UUID],
    });
    const events = new RecordingEventPublisher();
    const useCase = new StartSessionUseCase(repo, idGen, clock, events);
    const ws = makeWorkspaceId();
    await useCase.start({ workspaceId: ws, intent: null });
    events.clear();
    clock.advance(60_000); // 1 min — well within idle window
    const result = await useCase.start({ workspaceId: ws, intent: null });
    expect(result.sessionId.toString()).toBe(FIXED_SESSION_UUID);
    expect(result.previousSessionClosed).toBe(false);
    expect(events.published()).toHaveLength(0);
  });

  it("rotates when active session is idle", async () => {
    const repo = new InMemorySessionRepo();
    const clock = new FakeClock({ initialMs: ANCHOR_TIME_MS });
    const idGen = new FakeIdGenerator({
      sequence: [FIXED_SESSION_UUID, SECOND_SESSION_UUID],
    });
    const events = new RecordingEventPublisher();
    const useCase = new StartSessionUseCase(repo, idGen, clock, events);
    const ws = makeWorkspaceId();
    await useCase.start({ workspaceId: ws, intent: null });
    clock.advance(31 * 60 * 1000);
    const result = await useCase.start({ workspaceId: ws, intent: null });
    expect(result.sessionId.toString()).toBe(SECOND_SESSION_UUID);
    expect(result.previousSessionClosed).toBe(true);
  });

  it("propagates intent when supplied", async () => {
    const repo = new InMemorySessionRepo();
    const clock = new FakeClock({ initialMs: ANCHOR_TIME_MS });
    const idGen = new FakeIdGenerator({ sequence: [FIXED_SESSION_UUID] });
    const events = new RecordingEventPublisher();
    const useCase = new StartSessionUseCase(repo, idGen, clock, events);
    const result = await useCase.start({
      workspaceId: makeWorkspaceId(),
      intent: "Login flow",
    });
    const session = await repo.findById(result.sessionId);
    expect(session?.getIntent()?.toString()).toBe("Login flow");
  });

  it("ignores blank intent", async () => {
    const repo = new InMemorySessionRepo();
    const clock = new FakeClock({ initialMs: ANCHOR_TIME_MS });
    const idGen = new FakeIdGenerator({ sequence: [FIXED_SESSION_UUID] });
    const events = new RecordingEventPublisher();
    const useCase = new StartSessionUseCase(repo, idGen, clock, events);
    const result = await useCase.start({
      workspaceId: makeWorkspaceId(),
      intent: "   ",
    });
    const session = await repo.findById(result.sessionId);
    expect(session?.getIntent()).toBe(null);
  });
});

describe("EndSessionUseCase", () => {
  it("closes the active session", async () => {
    const repo = new InMemorySessionRepo();
    const clock = new FakeClock({ initialMs: ANCHOR_TIME_MS });
    const idGen = new FakeIdGenerator({ sequence: [FIXED_SESSION_UUID] });
    const events = new RecordingEventPublisher();
    const startUseCase = new StartSessionUseCase(repo, idGen, clock, events);
    const ws = makeWorkspaceId();
    await startUseCase.start({ workspaceId: ws, intent: null });
    events.clear();
    const endUseCase = new EndSessionUseCase(repo, clock, events);
    clock.advance(100);
    const result = await endUseCase.end({ workspaceId: ws });
    expect(result.sessionId?.toString()).toBe(FIXED_SESSION_UUID);
    expect(events.published().length).toBeGreaterThan(0);
  });

  it("returns null when no active session exists", async () => {
    const repo = new InMemorySessionRepo();
    const clock = new FakeClock({ initialMs: ANCHOR_TIME_MS });
    const events = new RecordingEventPublisher();
    const endUseCase = new EndSessionUseCase(repo, clock, events);
    const result = await endUseCase.end({ workspaceId: makeWorkspaceId() });
    expect(result.sessionId).toBe(null);
    expect(events.published()).toHaveLength(0);
  });
});
