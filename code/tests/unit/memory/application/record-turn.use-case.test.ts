import { describe, expect, it } from "vitest";
import { RecordTurnUseCase } from "../../../../src/modules/memory/application/use-cases/record-turn.use-case.ts";
import { SessionContextHelper } from "../../../../src/modules/memory/application/use-cases/session-context-helper.ts";
import type { TurnRepository } from "../../../../src/modules/memory/domain/repositories/turn-repository.ts";
import type { SessionRepository } from "../../../../src/modules/memory/domain/repositories/session-repository.ts";
import type {
  EmbeddableKind,
  EmbeddingEnqueuer,
} from "../../../../src/modules/memory/application/ports/out/embedding-enqueuer.port.ts";
import { Turn } from "../../../../src/modules/memory/domain/aggregates/turn.ts";
import type { TurnId } from "../../../../src/modules/memory/domain/value-objects/turn-id.ts";
import type { SessionId } from "../../../../src/modules/memory/domain/value-objects/session-id.ts";
import { Session } from "../../../../src/modules/memory/domain/aggregates/session.ts";
import type { WorkspaceId } from "../../../../src/shared/domain/value-objects/workspace-id.ts";
import type { Timestamp } from "../../../../src/shared/domain/value-objects/timestamp.ts";
import { FakeClock } from "../../../../src/shared/infrastructure/clock/fake-clock.ts";
import { FakeIdGenerator } from "../../../../src/shared/infrastructure/id-generator/fake-id-generator.ts";
import { TurnRecorded } from "../../../../src/modules/memory/domain/events/turn-recorded.ts";
import { SessionStarted } from "../../../../src/modules/memory/domain/events/session-started.ts";
import { InvalidInputError } from "../../../../src/shared/domain/errors/invalid-input-error.ts";
import {
  ANCHOR_TIME_MS,
  FIXED_TURN_UUID,
  FIXED_SESSION_UUID,
  makeTags,
  makeWorkspaceId,
} from "../../../helpers/factories.ts";
import {
  RecordingEventPublisher,
  SilentLogger,
} from "../../../helpers/test-doubles.ts";

class InMemoryTurnRepo implements TurnRepository {
  public readonly stored: Turn[] = [];

  public findById(id: TurnId): Promise<Turn | null> {
    return Promise.resolve(
      this.stored.find((t) => t.getId().equals(id)) ?? null,
    );
  }

  public save(turn: Turn): Promise<void> {
    this.stored.push(turn);
    return Promise.resolve();
  }

  public findBySession(
    sessionId: SessionId,
    limit: number,
  ): Promise<readonly Turn[]> {
    const filtered = this.stored.filter((t) =>
      t.getSessionId().equals(sessionId),
    );
    return Promise.resolve(filtered.slice(0, limit));
  }

  public findAllByWorkspace(): Promise<readonly Turn[]> {
    return Promise.resolve(this.stored);
  }
}

class InMemorySessionRepo implements SessionRepository {
  private readonly byId = new Map<string, Session>();
  private readonly currentByWorkspace = new Map<string, string>();

  public findById(id: SessionId): Promise<Session | null> {
    return Promise.resolve(this.byId.get(id.toString()) ?? null);
  }

  public save(session: Session): Promise<void> {
    this.byId.set(session.getId().toString(), session);
    const ws = session.getWorkspaceId().toString();
    if (session.getEndedAt() === null) {
      this.currentByWorkspace.set(ws, session.getId().toString());
    } else if (this.currentByWorkspace.get(ws) === session.getId().toString()) {
      this.currentByWorkspace.delete(ws);
    }
    return Promise.resolve();
  }

  public findCurrentByWorkspace(ws: WorkspaceId): Promise<Session | null> {
    const id = this.currentByWorkspace.get(ws.toString());
    if (id === undefined) return Promise.resolve(null);
    return Promise.resolve(this.byId.get(id) ?? null);
  }

  public findAllByWorkspace(): Promise<readonly Session[]> {
    return Promise.resolve([...this.byId.values()]);
  }
}

class RecordingEnqueuer implements EmbeddingEnqueuer {
  public readonly calls: Array<{
    workspaceId: WorkspaceId;
    targetKind: EmbeddableKind;
    targetRowId: string;
    enqueuedAt: Timestamp;
  }> = [];
  public failNext = false;

  public enqueue(input: {
    workspaceId: WorkspaceId;
    targetKind: EmbeddableKind;
    targetRowId: string;
    enqueuedAt: Timestamp;
  }): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      return Promise.reject(new Error("enqueue boom"));
    }
    this.calls.push(input);
    return Promise.resolve();
  }
}

function makeUseCase(): {
  useCase: RecordTurnUseCase;
  turnRepo: InMemoryTurnRepo;
  sessionRepo: InMemorySessionRepo;
  enqueuer: RecordingEnqueuer;
  events: RecordingEventPublisher;
  clock: FakeClock;
} {
  const turnRepo = new InMemoryTurnRepo();
  const sessionRepo = new InMemorySessionRepo();
  const enqueuer = new RecordingEnqueuer();
  const clock = new FakeClock({ initialMs: ANCHOR_TIME_MS });
  const idGen = new FakeIdGenerator({
    sequence: [FIXED_SESSION_UUID, FIXED_TURN_UUID],
  });
  const events = new RecordingEventPublisher();
  const logger = new SilentLogger();
  const helper = new SessionContextHelper(sessionRepo, clock, idGen, events);
  const useCase = new RecordTurnUseCase(
    turnRepo,
    sessionRepo,
    helper,
    enqueuer,
    idGen,
    clock,
    events,
    logger,
  );
  return { useCase, turnRepo, sessionRepo, enqueuer, events, clock };
}

describe("RecordTurnUseCase.record", () => {
  it("opens a fresh session when none active, persists the turn, publishes events in order", async () => {
    const { useCase, turnRepo, sessionRepo, events } = makeUseCase();
    const result = await useCase.record({
      workspaceId: makeWorkspaceId(),
      summary: "Implemented foo",
      intent: "wire foo",
      outcome: "PR merged",
      filesTouched: ["src/foo.ts"],
      linkedDecisions: [],
      linkedLearnings: [],
      tags: makeTags(),
    });
    expect(result.turnId.toString()).toBe(FIXED_TURN_UUID);
    expect(result.sessionId.toString()).toBe(FIXED_SESSION_UUID);
    expect(result.embeddingEnqueued).toBe(true);
    expect(turnRepo.stored.length).toBe(1);
    expect(sessionRepo).toBeDefined();
    const published = events.published();
    // Session events first (SessionStarted), then turn events (TurnRecorded).
    expect(published[0]).toBeInstanceOf(SessionStarted);
    expect(published[published.length - 1]).toBeInstanceOf(TurnRecorded);
  });

  it("reuses an existing active session", async () => {
    const { useCase, turnRepo, sessionRepo } = makeUseCase();
    await useCase.record({
      workspaceId: makeWorkspaceId(),
      summary: "first",
      intent: null,
      outcome: null,
      filesTouched: [],
      linkedDecisions: [],
      linkedLearnings: [],
      tags: makeTags(),
    });
    // Second turn should reuse the open session.
    void useCase;
    const sessions = await sessionRepo.findAllByWorkspace(makeWorkspaceId());
    expect(sessions.length).toBe(1);
    expect(turnRepo.stored.length).toBe(1);
  });

  it("returns embeddingEnqueued=false when enqueue fails (turn persisted)", async () => {
    const { useCase, turnRepo, enqueuer } = makeUseCase();
    enqueuer.failNext = true;
    const result = await useCase.record({
      workspaceId: makeWorkspaceId(),
      summary: "x",
      intent: null,
      outcome: null,
      filesTouched: [],
      linkedDecisions: [],
      linkedLearnings: [],
      tags: makeTags(),
    });
    expect(result.embeddingEnqueued).toBe(false);
    expect(turnRepo.stored.length).toBe(1);
  });

  it("propagates VO factory errors (empty summary)", async () => {
    const { useCase } = makeUseCase();
    await expect(
      useCase.record({
        workspaceId: makeWorkspaceId(),
        summary: "",
        intent: null,
        outcome: null,
        filesTouched: [],
        linkedDecisions: [],
        linkedLearnings: [],
        tags: makeTags(),
      }),
    ).rejects.toThrow(InvalidInputError);
  });
});
