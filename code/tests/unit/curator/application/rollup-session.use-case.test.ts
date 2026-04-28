import { describe, expect, it } from "vitest";
import { RollupSessionUseCase } from "../../../../src/modules/curator/application/use-cases/rollup-session.use-case.ts";
import type {
  SessionRollupReader,
  TurnRollupProjection,
} from "../../../../src/modules/curator/application/ports/out/session-rollup-reader.port.ts";
import type { SessionRepository } from "../../../../src/modules/memory/domain/repositories/session-repository.ts";
import { Session } from "../../../../src/modules/memory/domain/aggregates/session.ts";
import { SessionId } from "../../../../src/modules/memory/domain/value-objects/session-id.ts";
import { Confidence } from "../../../../src/shared/domain/value-objects/confidence.ts";
import { Timestamp } from "../../../../src/shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../src/shared/domain/value-objects/workspace-id.ts";
import { FakeClock } from "../../../../src/shared/infrastructure/clock/fake-clock.ts";
import {
  ANCHOR_TIME_MS,
  FIXED_SESSION_UUID,
  makeWorkspaceId,
} from "../../../helpers/factories.ts";
import { SilentLogger } from "../../../helpers/test-doubles.ts";

class StubSessionRepo implements SessionRepository {
  public current: Session | null = null;
  public readonly saved: Session[] = [];

  public findById(): Promise<Session | null> {
    return Promise.resolve(null);
  }

  public save(session: Session): Promise<void> {
    this.saved.push(session);
    return Promise.resolve();
  }

  public findCurrentByWorkspace(): Promise<Session | null> {
    return Promise.resolve(this.current);
  }

  public findAllByWorkspace(): Promise<readonly Session[]> {
    return Promise.resolve([]);
  }
}

class StubRollupReader implements SessionRollupReader {
  public turns: TurnRollupProjection[] = [];
  public lastLimit: number | null = null;

  public listTopTurns(input: {
    workspaceId: WorkspaceId;
    sessionId: string;
    limit: number;
  }): Promise<readonly TurnRollupProjection[]> {
    void input;
    this.lastLimit = input.limit;
    return Promise.resolve(this.turns);
  }
}

function makeTurn(
  id: string,
  summary: string,
  confidence: number = 1,
): TurnRollupProjection {
  return {
    turnId: id,
    summary,
    confidence: Confidence.of(confidence),
    recordedAt: Timestamp.fromEpochMs(ANCHOR_TIME_MS),
  };
}

function makeUseCase(): {
  useCase: RollupSessionUseCase;
  sessions: StubSessionRepo;
  reader: StubRollupReader;
  clock: FakeClock;
} {
  const sessions = new StubSessionRepo();
  const reader = new StubRollupReader();
  const clock = new FakeClock({ initialMs: ANCHOR_TIME_MS });
  const useCase = new RollupSessionUseCase(
    sessions,
    reader,
    clock,
    new SilentLogger(),
  );
  return { useCase, sessions, reader, clock };
}

function buildSession(workspaceId: WorkspaceId): Session {
  return Session.start({
    id: SessionId.from(FIXED_SESSION_UUID),
    workspaceId,
    startedAt: Timestamp.fromEpochMs(ANCHOR_TIME_MS),
    idleTimeoutMs: 30 * 60 * 1000,
  });
}

describe("RollupSessionUseCase", () => {
  it("returns zero result when there is no current session", async () => {
    const { useCase, sessions } = makeUseCase();
    const workspaceId = makeWorkspaceId();
    sessions.current = null;
    const result = await useCase.rollup({ workspaceId });
    expect(result.sessionsClosed).toBe(0);
    expect(result.summariesGenerated).toBe(0);
    expect(result.learningsCreated).toBe(0);
  });

  it("returns zero result when the current session is not idle", async () => {
    const { useCase, sessions, clock } = makeUseCase();
    const workspaceId = makeWorkspaceId();
    sessions.current = buildSession(workspaceId);
    // Clock at session start; not yet idle.
    void clock; // explicit no advance.
    const result = await useCase.rollup({ workspaceId });
    expect(result.sessionsClosed).toBe(0);
    expect(sessions.saved.length).toBe(0);
  });

  it("rolls up an expired session: applies summary, ends, persists, returns counters", async () => {
    const { useCase, sessions, reader, clock } = makeUseCase();
    const workspaceId = makeWorkspaceId();
    sessions.current = buildSession(workspaceId);
    reader.turns = [
      makeTurn("01952f3c-cccc-7000-8000-000000000001", "first insight"),
      makeTurn("01952f3c-cccc-7000-8000-000000000002", "second insight"),
    ];
    clock.advance(31 * 60 * 1000); // > 30-min idle.

    const result = await useCase.rollup({ workspaceId });
    expect(result.sessionsClosed).toBe(1);
    expect(result.summariesGenerated).toBe(1);
    expect(result.learningsCreated).toBe(0);
    expect(sessions.saved.length).toBe(1);
    const persisted = sessions.saved[0];
    expect(persisted?.isEnded()).toBe(true);
    const summary = persisted?.getSummary()?.toString();
    expect(summary).toContain("Session summary:");
    expect(summary).toContain("first insight");
    expect(summary).toContain("second insight");
    // Reader was asked for top-5 turns.
    expect(reader.lastLimit).toBe(5);
  });

  it("rolls up a session with NO turns: ends but does not generate summary", async () => {
    const { useCase, sessions, reader, clock } = makeUseCase();
    const workspaceId = makeWorkspaceId();
    sessions.current = buildSession(workspaceId);
    reader.turns = [];
    clock.advance(31 * 60 * 1000);

    const result = await useCase.rollup({ workspaceId });
    expect(result.sessionsClosed).toBe(1);
    expect(result.summariesGenerated).toBe(0);
    expect(sessions.saved.length).toBe(1);
    expect(sessions.saved[0]?.isEnded()).toBe(true);
    expect(sessions.saved[0]?.getSummary()).toBeNull();
  });

  it("truncates summaries that exceed the soft cap (1500 chars)", async () => {
    const { useCase, sessions, reader, clock } = makeUseCase();
    const workspaceId = makeWorkspaceId();
    sessions.current = buildSession(workspaceId);
    // Build 5 long turns that together exceed 1500 chars.
    const longSummary = "x".repeat(400);
    reader.turns = [
      makeTurn("id-1", longSummary),
      makeTurn("id-2", longSummary),
      makeTurn("id-3", longSummary),
      makeTurn("id-4", longSummary),
      makeTurn("id-5", longSummary),
    ];
    clock.advance(31 * 60 * 1000);

    const result = await useCase.rollup({ workspaceId });
    expect(result.summariesGenerated).toBe(1);
    const persistedSummary = sessions.saved[0]?.getSummary()?.toString();
    expect(persistedSummary?.length).toBeLessThanOrEqual(1500);
    expect(persistedSummary?.endsWith("...")).toBe(true);
  });
});
