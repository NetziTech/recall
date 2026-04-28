import { describe, expect, it } from "vitest";
import { Task } from "../../../../src/modules/memory/domain/aggregates/task.ts";
import { TaskId } from "../../../../src/modules/memory/domain/value-objects/task-id.ts";
import { TaskTitle } from "../../../../src/modules/memory/domain/value-objects/task-title.ts";
import { TaskDescription } from "../../../../src/modules/memory/domain/value-objects/task-description.ts";
import { TaskPriority } from "../../../../src/modules/memory/domain/value-objects/task-priority.ts";
import { TaskCreated } from "../../../../src/modules/memory/domain/events/task-created.ts";
import { TaskStarted } from "../../../../src/modules/memory/domain/events/task-started.ts";
import { TaskBlocked } from "../../../../src/modules/memory/domain/events/task-blocked.ts";
import { TaskUnblocked } from "../../../../src/modules/memory/domain/events/task-unblocked.ts";
import { TaskCompleted } from "../../../../src/modules/memory/domain/events/task-completed.ts";
import { TaskDeleted } from "../../../../src/modules/memory/domain/events/task-deleted.ts";
import { InvalidTaskTransitionError } from "../../../../src/modules/memory/domain/errors/invalid-task-transition-error.ts";
import {
  ANCHOR_TIME_MS,
  FIXED_TASK_UUID,
  makeTags,
  makeTimestamp,
  makeWorkspaceId,
} from "../../../helpers/factories.ts";

function makeTask(): Task {
  return Task.create({
    id: TaskId.from(FIXED_TASK_UUID),
    workspaceId: makeWorkspaceId(),
    sessionId: null,
    title: TaskTitle.from("Implement login"),
    description: TaskDescription.from("OAuth2 flow"),
    priority: TaskPriority.high(),
    tags: makeTags(["auth"]),
    dueAt: null,
    occurredAt: makeTimestamp(),
  });
}

describe("Task (aggregate)", () => {
  describe("create", () => {
    it("starts in todo status with no completedAt", () => {
      const t = makeTask();
      expect(t.getStatus().isTodo()).toBe(true);
      expect(t.getCompletedAt()).toBe(null);
      expect(t.isOpen()).toBe(true);
    });

    it("emits TaskCreated", () => {
      const t = makeTask();
      const events = t.pullEvents();
      expect(events.length).toBe(1);
      expect(events[0]).toBeInstanceOf(TaskCreated);
    });
  });

  describe("transitions: todo → in_progress (start)", () => {
    it("emits TaskStarted", () => {
      const t = makeTask();
      t.pullEvents();
      t.start({ occurredAt: makeTimestamp(ANCHOR_TIME_MS + 100) });
      expect(t.getStatus().isInProgress()).toBe(true);
      const events = t.pullEvents();
      expect(events.length).toBe(1);
      expect(events[0]).toBeInstanceOf(TaskStarted);
    });
  });

  describe("transitions: todo → blocked", () => {
    it("emits TaskBlocked", () => {
      const t = makeTask();
      t.pullEvents();
      t.block({ occurredAt: makeTimestamp(ANCHOR_TIME_MS + 100) });
      expect(t.getStatus().isBlocked()).toBe(true);
      const events = t.pullEvents();
      expect(events.length).toBe(1);
      expect(events[0]).toBeInstanceOf(TaskBlocked);
    });
  });

  describe("transitions: blocked → todo (unblock)", () => {
    it("emits TaskUnblocked", () => {
      const t = makeTask();
      t.block({ occurredAt: makeTimestamp(ANCHOR_TIME_MS + 100) });
      t.pullEvents();
      t.unblock({ occurredAt: makeTimestamp(ANCHOR_TIME_MS + 200) });
      expect(t.getStatus().isTodo()).toBe(true);
      const events = t.pullEvents();
      expect(events.length).toBe(1);
      expect(events[0]).toBeInstanceOf(TaskUnblocked);
    });
  });

  describe("transitions: in_progress → done (complete)", () => {
    it("emits TaskCompleted and pins completedAt", () => {
      const t = makeTask();
      t.start({ occurredAt: makeTimestamp(ANCHOR_TIME_MS + 100) });
      t.pullEvents();
      t.complete({ occurredAt: makeTimestamp(ANCHOR_TIME_MS + 200) });
      expect(t.getStatus().isDone()).toBe(true);
      expect(t.getCompletedAt()).not.toBe(null);
      expect(t.isOpen()).toBe(false);
      const events = t.pullEvents();
      expect(events.length).toBe(1);
      expect(events[0]).toBeInstanceOf(TaskCompleted);
    });
  });

  describe("illegal transitions", () => {
    it("rejects todo → done (must go through in_progress)", () => {
      const t = makeTask();
      expect(() =>
        t.complete({ occurredAt: makeTimestamp(ANCHOR_TIME_MS + 100) }),
      ).toThrow(InvalidTaskTransitionError);
    });

    it("rejects blocked → done", () => {
      const t = makeTask();
      t.block({ occurredAt: makeTimestamp(ANCHOR_TIME_MS + 100) });
      expect(() =>
        t.complete({ occurredAt: makeTimestamp(ANCHOR_TIME_MS + 200) }),
      ).toThrow(InvalidTaskTransitionError);
    });

    it("rejects done → anything (terminal state)", () => {
      const t = makeTask();
      t.start({ occurredAt: makeTimestamp(ANCHOR_TIME_MS + 100) });
      t.complete({ occurredAt: makeTimestamp(ANCHOR_TIME_MS + 200) });
      expect(() =>
        t.start({ occurredAt: makeTimestamp(ANCHOR_TIME_MS + 300) }),
      ).toThrow(InvalidTaskTransitionError);
      expect(() =>
        t.block({ occurredAt: makeTimestamp(ANCHOR_TIME_MS + 300) }),
      ).toThrow(InvalidTaskTransitionError);
      expect(() =>
        t.unblock({ occurredAt: makeTimestamp(ANCHOR_TIME_MS + 300) }),
      ).toThrow(InvalidTaskTransitionError);
    });

    it("rejects todo → todo (self-transition via unblock)", () => {
      const t = makeTask();
      expect(() =>
        t.unblock({ occurredAt: makeTimestamp(ANCHOR_TIME_MS + 100) }),
      ).toThrow(InvalidTaskTransitionError);
    });

    it("blocked → in_progress is legal (start)", () => {
      const t = makeTask();
      t.block({ occurredAt: makeTimestamp(ANCHOR_TIME_MS + 100) });
      t.start({ occurredAt: makeTimestamp(ANCHOR_TIME_MS + 200) });
      expect(t.getStatus().isInProgress()).toBe(true);
    });

    it("in_progress → blocked is legal", () => {
      const t = makeTask();
      t.start({ occurredAt: makeTimestamp(ANCHOR_TIME_MS + 100) });
      t.block({ occurredAt: makeTimestamp(ANCHOR_TIME_MS + 200) });
      expect(t.getStatus().isBlocked()).toBe(true);
    });
  });

  describe("delete", () => {
    it("emits TaskDeleted from todo", () => {
      const t = makeTask();
      t.pullEvents();
      t.delete({ occurredAt: makeTimestamp(ANCHOR_TIME_MS + 100) });
      const events = t.pullEvents();
      expect(events.length).toBe(1);
      expect(events[0]).toBeInstanceOf(TaskDeleted);
      expect(t.getUpdatedAt().toEpochMs()).toBe(ANCHOR_TIME_MS + 100);
    });

    it("emits TaskDeleted from in_progress (any status is legal)", () => {
      const t = makeTask();
      t.start({ occurredAt: makeTimestamp(ANCHOR_TIME_MS + 100) });
      t.pullEvents();
      t.delete({ occurredAt: makeTimestamp(ANCHOR_TIME_MS + 200) });
      const events = t.pullEvents();
      expect(events.length).toBe(1);
      expect(events[0]).toBeInstanceOf(TaskDeleted);
    });

    it("emits TaskDeleted from blocked", () => {
      const t = makeTask();
      t.block({ occurredAt: makeTimestamp(ANCHOR_TIME_MS + 100) });
      t.pullEvents();
      t.delete({ occurredAt: makeTimestamp(ANCHOR_TIME_MS + 200) });
      const events = t.pullEvents();
      expect(events.length).toBe(1);
      expect(events[0]).toBeInstanceOf(TaskDeleted);
    });

    it("emits TaskDeleted from done (terminal but still deletable)", () => {
      const t = makeTask();
      t.start({ occurredAt: makeTimestamp(ANCHOR_TIME_MS + 100) });
      t.complete({ occurredAt: makeTimestamp(ANCHOR_TIME_MS + 200) });
      t.pullEvents();
      t.delete({ occurredAt: makeTimestamp(ANCHOR_TIME_MS + 300) });
      const events = t.pullEvents();
      expect(events.length).toBe(1);
      expect(events[0]).toBeInstanceOf(TaskDeleted);
    });

    it("preserves the workspaceId and taskId on the event", () => {
      const t = makeTask();
      const occurredAt = makeTimestamp(ANCHOR_TIME_MS + 100);
      t.delete({ occurredAt });
      const event = t
        .pullEvents()
        .find((e): e is TaskDeleted => e instanceof TaskDeleted);
      expect(event).toBeDefined();
      expect(event?.taskId.toString()).toBe(FIXED_TASK_UUID);
      expect(event?.occurredAt.toEpochMs()).toBe(ANCHOR_TIME_MS + 100);
    });
  });

  describe("rehydrate", () => {
    it("rebuilds without emitting events", () => {
      const t = Task.rehydrate({
        id: TaskId.from(FIXED_TASK_UUID),
        workspaceId: makeWorkspaceId(),
        sessionId: null,
        title: TaskTitle.from("Done task"),
        description: null,
        status: t__doneStatus(),
        priority: TaskPriority.medium(),
        tags: makeTags(),
        dueAt: null,
        createdAt: makeTimestamp(),
        updatedAt: makeTimestamp(ANCHOR_TIME_MS + 100),
        completedAt: makeTimestamp(ANCHOR_TIME_MS + 100),
      });
      expect(t.pullEvents()).toHaveLength(0);
      expect(t.getStatus().isDone()).toBe(true);
    });
  });

  describe("getters", () => {
    it("exposes all fields", () => {
      const t = makeTask();
      expect(t.getId().toString()).toBe(FIXED_TASK_UUID);
      expect(t.getTitle().toString()).toBe("Implement login");
      expect(t.getDescription()?.toString()).toBe("OAuth2 flow");
      expect(t.getPriority().equals(TaskPriority.high())).toBe(true);
      expect(t.getTags().size()).toBe(1);
      expect(t.getDueAt()).toBe(null);
    });
  });
});

// Helper because importing TaskStatus.done() inline keeps the imports tidy.
import { TaskStatus } from "../../../../src/modules/memory/domain/value-objects/task-status.ts";
function t__doneStatus(): TaskStatus {
  return TaskStatus.done();
}
