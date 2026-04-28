import { describe, expect, it } from "vitest";
import { TrackTaskUseCase } from "../../../../src/modules/memory/application/use-cases/track-task.use-case.ts";
import { SessionContextHelper } from "../../../../src/modules/memory/application/use-cases/session-context-helper.ts";
import { MemoryApplicationError } from "../../../../src/modules/memory/application/errors/memory-application-error.ts";
import type { TaskRepository } from "../../../../src/modules/memory/domain/repositories/task-repository.ts";
import type { SessionRepository } from "../../../../src/modules/memory/domain/repositories/session-repository.ts";
import { Task } from "../../../../src/modules/memory/domain/aggregates/task.ts";
import { Session } from "../../../../src/modules/memory/domain/aggregates/session.ts";
import { SessionId } from "../../../../src/modules/memory/domain/value-objects/session-id.ts";
import { TaskId } from "../../../../src/modules/memory/domain/value-objects/task-id.ts";
import { TaskPriority } from "../../../../src/modules/memory/domain/value-objects/task-priority.ts";
import { TaskStatus } from "../../../../src/modules/memory/domain/value-objects/task-status.ts";
import type { WorkspaceId } from "../../../../src/shared/domain/value-objects/workspace-id.ts";
import { FakeClock } from "../../../../src/shared/infrastructure/clock/fake-clock.ts";
import { FakeIdGenerator } from "../../../../src/shared/infrastructure/id-generator/fake-id-generator.ts";
import {
  ANCHOR_TIME_MS,
  FIXED_SESSION_UUID,
  FIXED_TASK_UUID,
  makeTags,
  makeTimestamp,
  makeWorkspaceId,
} from "../../../helpers/factories.ts";
import { RecordingEventPublisher } from "../../../helpers/test-doubles.ts";
import { TaskCreated } from "../../../../src/modules/memory/domain/events/task-created.ts";
import { TaskStarted } from "../../../../src/modules/memory/domain/events/task-started.ts";
import { TaskBlocked } from "../../../../src/modules/memory/domain/events/task-blocked.ts";
import { TaskUnblocked } from "../../../../src/modules/memory/domain/events/task-unblocked.ts";
import { TaskCompleted } from "../../../../src/modules/memory/domain/events/task-completed.ts";
import { TaskDeleted } from "../../../../src/modules/memory/domain/events/task-deleted.ts";

class InMemoryTaskRepo implements TaskRepository {
  public readonly byId = new Map<string, Task>();

  public findById(id: TaskId): Promise<Task | null> {
    return Promise.resolve(this.byId.get(id.toString()) ?? null);
  }

  public save(task: Task): Promise<void> {
    this.byId.set(task.getId().toString(), task);
    return Promise.resolve();
  }

  public delete(id: TaskId): Promise<boolean> {
    return Promise.resolve(this.byId.delete(id.toString()));
  }

  public findOpenByWorkspace(): Promise<readonly Task[]> {
    return Promise.resolve(
      [...this.byId.values()].filter((t) => !t.getStatus().isDone()),
    );
  }

  public findByStatus(
    _ws: WorkspaceId,
    status: TaskStatus,
  ): Promise<readonly Task[]> {
    void _ws;
    return Promise.resolve(
      [...this.byId.values()].filter((t) => t.getStatus().equals(status)),
    );
  }

  public findByPriority(
    _ws: WorkspaceId,
    priority: TaskPriority,
  ): Promise<readonly Task[]> {
    void _ws;
    return Promise.resolve(
      [...this.byId.values()].filter((t) => t.getPriority().equals(priority)),
    );
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
    return Promise.resolve(id === undefined ? null : (this.byId.get(id) ?? null));
  }

  public findAllByWorkspace(): Promise<readonly Session[]> {
    return Promise.resolve([...this.byId.values()]);
  }
}

function makeUseCase(): {
  useCase: TrackTaskUseCase;
  taskRepo: InMemoryTaskRepo;
  sessionRepo: InMemorySessionRepo;
  events: RecordingEventPublisher;
  clock: FakeClock;
} {
  const taskRepo = new InMemoryTaskRepo();
  const sessionRepo = new InMemorySessionRepo();
  const clock = new FakeClock({ initialMs: ANCHOR_TIME_MS });
  const idGen = new FakeIdGenerator({ seed: 1 });
  const events = new RecordingEventPublisher();
  const helper = new SessionContextHelper(sessionRepo, clock, idGen, events);
  const useCase = new TrackTaskUseCase(taskRepo, helper, idGen, clock, events);
  return { useCase, taskRepo, sessionRepo, events, clock };
}

describe("TrackTaskUseCase.create", () => {
  it("creates a fresh task with sessionId=null when no active session", async () => {
    const { useCase, taskRepo, events } = makeUseCase();
    const result = await useCase.create({
      workspaceId: makeWorkspaceId(),
      title: "Add tests",
      description: "Cover the gap",
      priority: TaskPriority.high(),
      tags: makeTags(),
      dueAtMs: null,
    });
    expect(taskRepo.byId.size).toBe(1);
    const task = taskRepo.byId.get(result.taskId.toString());
    expect(task?.getSessionId()).toBe(null);
    expect(task?.getStatus().isTodo()).toBe(true);
    expect(events.published()[0]).toBeInstanceOf(TaskCreated);
  });

  it("attaches active session id when one exists", async () => {
    const { useCase, taskRepo, sessionRepo } = makeUseCase();
    const ws = makeWorkspaceId();
    const session = Session.start({
      id: SessionId.from(FIXED_SESSION_UUID),
      workspaceId: ws,
      startedAt: makeTimestamp(),
      intent: null,
      resumedFrom: null,
    });
    session.pullEvents();
    await sessionRepo.save(session);
    const result = await useCase.create({
      workspaceId: ws,
      title: "T",
      description: null,
      priority: TaskPriority.medium(),
      tags: makeTags(),
      dueAtMs: null,
    });
    const task = taskRepo.byId.get(result.taskId.toString());
    expect(task?.getSessionId()?.toString()).toBe(FIXED_SESSION_UUID);
  });

  it("treats whitespace-only description as null", async () => {
    const { useCase, taskRepo } = makeUseCase();
    const result = await useCase.create({
      workspaceId: makeWorkspaceId(),
      title: "T",
      description: "   ",
      priority: TaskPriority.low(),
      tags: makeTags(),
      dueAtMs: null,
    });
    const task = taskRepo.byId.get(result.taskId.toString());
    expect(task?.getDescription()).toBe(null);
  });

  it("propagates dueAtMs as Timestamp", async () => {
    const { useCase, taskRepo } = makeUseCase();
    const result = await useCase.create({
      workspaceId: makeWorkspaceId(),
      title: "T",
      description: null,
      priority: TaskPriority.low(),
      tags: makeTags(),
      dueAtMs: ANCHOR_TIME_MS + 86_400_000,
    });
    const task = taskRepo.byId.get(result.taskId.toString());
    expect(task?.getDueAt()?.toEpochMs()).toBe(ANCHOR_TIME_MS + 86_400_000);
  });
});

describe("TrackTaskUseCase.start", () => {
  it("transitions todo -> in_progress, publishes TaskStarted", async () => {
    const { useCase, taskRepo, events } = makeUseCase();
    const created = await useCase.create({
      workspaceId: makeWorkspaceId(),
      title: "T",
      description: null,
      priority: TaskPriority.medium(),
      tags: makeTags(),
      dueAtMs: null,
    });
    events.clear();
    const result = await useCase.start({
      workspaceId: makeWorkspaceId(),
      taskId: created.taskId,
    });
    expect(result.previousStatus.isTodo()).toBe(true);
    expect(result.currentStatus.isInProgress()).toBe(true);
    expect(taskRepo.byId.get(created.taskId.toString())?.getStatus().isInProgress()).toBe(
      true,
    );
    expect(events.published()[0]).toBeInstanceOf(TaskStarted);
  });

  it("throws taskNotFound when id is unknown", async () => {
    const { useCase } = makeUseCase();
    const fake = FIXED_TASK_UUID;
    await expect(
      useCase.start({
        workspaceId: makeWorkspaceId(),
        taskId: { toString: () => fake, equals: () => false } as unknown as Parameters<
          typeof useCase.start
        >[0]["taskId"],
      }),
    ).rejects.toBeInstanceOf(MemoryApplicationError);
  });
});

describe("TrackTaskUseCase.block / unblock / complete", () => {
  it("block transitions todo -> blocked, then unblock back to todo", async () => {
    const { useCase, events } = makeUseCase();
    const created = await useCase.create({
      workspaceId: makeWorkspaceId(),
      title: "T",
      description: null,
      priority: TaskPriority.medium(),
      tags: makeTags(),
      dueAtMs: null,
    });
    events.clear();
    const blocked = await useCase.block({
      workspaceId: makeWorkspaceId(),
      taskId: created.taskId,
    });
    expect(blocked.currentStatus.isBlocked()).toBe(true);
    expect(events.published()[0]).toBeInstanceOf(TaskBlocked);
    events.clear();
    const unblocked = await useCase.unblock({
      workspaceId: makeWorkspaceId(),
      taskId: created.taskId,
    });
    expect(unblocked.currentStatus.isTodo()).toBe(true);
    expect(events.published()[0]).toBeInstanceOf(TaskUnblocked);
  });

  it("complete transitions in_progress -> done and pins completedAt", async () => {
    const { useCase, taskRepo, events, clock } = makeUseCase();
    const created = await useCase.create({
      workspaceId: makeWorkspaceId(),
      title: "T",
      description: null,
      priority: TaskPriority.medium(),
      tags: makeTags(),
      dueAtMs: null,
    });
    await useCase.start({
      workspaceId: makeWorkspaceId(),
      taskId: created.taskId,
    });
    clock.advance(1000);
    events.clear();
    const result = await useCase.complete({
      workspaceId: makeWorkspaceId(),
      taskId: created.taskId,
    });
    expect(result.currentStatus.isDone()).toBe(true);
    expect(taskRepo.byId.get(created.taskId.toString())?.getCompletedAt()).not.toBe(
      null,
    );
    expect(events.published()[0]).toBeInstanceOf(TaskCompleted);
  });
});

describe("TrackTaskUseCase.list", () => {
  it("returns open tasks when status is null", async () => {
    const { useCase } = makeUseCase();
    await useCase.create({
      workspaceId: makeWorkspaceId(),
      title: "A",
      description: null,
      priority: TaskPriority.medium(),
      tags: makeTags(),
      dueAtMs: null,
    });
    const open = await useCase.list({
      workspaceId: makeWorkspaceId(),
      status: null,
    });
    expect(open.length).toBe(1);
  });

  it("returns filtered tasks when status is provided", async () => {
    const { useCase } = makeUseCase();
    const t1 = await useCase.create({
      workspaceId: makeWorkspaceId(),
      title: "A",
      description: null,
      priority: TaskPriority.medium(),
      tags: makeTags(),
      dueAtMs: null,
    });
    await useCase.create({
      workspaceId: makeWorkspaceId(),
      title: "B",
      description: null,
      priority: TaskPriority.medium(),
      tags: makeTags(),
      dueAtMs: null,
    });
    await useCase.start({
      workspaceId: makeWorkspaceId(),
      taskId: t1.taskId,
    });
    const inProgress = await useCase.list({
      workspaceId: makeWorkspaceId(),
      status: TaskStatus.inProgress(),
    });
    expect(inProgress.length).toBe(1);
    const todos = await useCase.list({
      workspaceId: makeWorkspaceId(),
      status: TaskStatus.todo(),
    });
    expect(todos.length).toBe(1);
  });
});

describe("TrackTaskUseCase.get", () => {
  it("returns the task when the id exists", async () => {
    const { useCase } = makeUseCase();
    const ws = makeWorkspaceId();
    const created = await useCase.create({
      workspaceId: ws,
      title: "fetch me",
      description: null,
      priority: TaskPriority.medium(),
      tags: makeTags(),
      dueAtMs: null,
    });
    const task = await useCase.get({
      workspaceId: ws,
      taskId: created.taskId,
    });
    expect(task.getId().toString()).toBe(created.taskId.toString());
    expect(task.getTitle().toString()).toBe("fetch me");
  });

  it("throws taskNotFound when the id is unknown", async () => {
    const { useCase } = makeUseCase();
    await expect(
      useCase.get({
        workspaceId: makeWorkspaceId(),
        taskId: TaskId.from(FIXED_TASK_UUID),
      }),
    ).rejects.toMatchObject({ code: "memory.task-not-found" });
  });

  it("emits no event on a successful read", async () => {
    const { useCase, events } = makeUseCase();
    const ws = makeWorkspaceId();
    const created = await useCase.create({
      workspaceId: ws,
      title: "read-only",
      description: null,
      priority: TaskPriority.low(),
      tags: makeTags(),
      dueAtMs: null,
    });
    events.clear();
    await useCase.get({ workspaceId: ws, taskId: created.taskId });
    expect(events.published()).toHaveLength(0);
  });
});

describe("TrackTaskUseCase.delete", () => {
  it("removes the task and publishes TaskDeleted", async () => {
    const { useCase, taskRepo, events } = makeUseCase();
    const ws = makeWorkspaceId();
    const created = await useCase.create({
      workspaceId: ws,
      title: "delete me",
      description: null,
      priority: TaskPriority.low(),
      tags: makeTags(),
      dueAtMs: null,
    });
    events.clear();
    const result = await useCase.delete({
      workspaceId: ws,
      taskId: created.taskId,
    });
    expect(result.deleted).toBe(true);
    expect(result.taskId.toString()).toBe(created.taskId.toString());
    expect(taskRepo.byId.has(created.taskId.toString())).toBe(false);
    const published = events.published();
    expect(published).toHaveLength(1);
    expect(published[0]).toBeInstanceOf(TaskDeleted);
  });

  it("can delete a `done` task (no lifecycle restriction)", async () => {
    const { useCase, taskRepo } = makeUseCase();
    const ws = makeWorkspaceId();
    const created = await useCase.create({
      workspaceId: ws,
      title: "done then deleted",
      description: null,
      priority: TaskPriority.medium(),
      tags: makeTags(),
      dueAtMs: null,
    });
    await useCase.start({ workspaceId: ws, taskId: created.taskId });
    await useCase.complete({ workspaceId: ws, taskId: created.taskId });
    expect(
      taskRepo.byId.get(created.taskId.toString())?.getStatus().isDone(),
    ).toBe(true);
    const result = await useCase.delete({
      workspaceId: ws,
      taskId: created.taskId,
    });
    expect(result.deleted).toBe(true);
    expect(taskRepo.byId.has(created.taskId.toString())).toBe(false);
  });

  it("throws taskNotFound when the id is unknown", async () => {
    const { useCase, events } = makeUseCase();
    await expect(
      useCase.delete({
        workspaceId: makeWorkspaceId(),
        taskId: TaskId.from(FIXED_TASK_UUID),
      }),
    ).rejects.toMatchObject({ code: "memory.task-not-found" });
    // No event emitted on the missing-id branch.
    expect(events.published()).toHaveLength(0);
  });
});

describe("TrackTaskUseCase.currentSessionId", () => {
  it("returns null when no session exists", async () => {
    const { useCase } = makeUseCase();
    const id = await useCase.currentSessionId(makeWorkspaceId());
    expect(id).toBe(null);
  });

  it("returns the active session id", async () => {
    const { useCase, sessionRepo } = makeUseCase();
    const ws = makeWorkspaceId();
    const session = Session.start({
      id: SessionId.from(FIXED_SESSION_UUID),
      workspaceId: ws,
      startedAt: makeTimestamp(),
      intent: null,
      resumedFrom: null,
    });
    session.pullEvents();
    await sessionRepo.save(session);
    const id = await useCase.currentSessionId(ws);
    expect(id?.toString()).toBe(FIXED_SESSION_UUID);
  });
});
