/**
 * Integration test — Flow F: `mem.task` (track tasks).
 *
 * Walks the canonical task lifecycle through the wired
 * `TrackTaskUseCase`:
 *
 *   create → start → block → unblock → complete
 *
 * Verifies persistence + status transitions + event publication at
 * each step.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Tags } from "../../src/shared/domain/value-objects/tags.ts";
import { TaskPriority } from "../../src/modules/memory/domain/value-objects/task-priority.ts";
import type { DomainEvent } from "../../src/shared/domain/types/domain-event.ts";
import { buildTestContainer, type TestContainer } from "./_helpers/build-test-container.ts";

describe("integration / F / mem.task — task lifecycle", () => {
  let ctx: TestContainer;
  let collected: DomainEvent[];

  beforeEach(async () => {
    ctx = await buildTestContainer();
    collected = [];
    ctx.eventBus.subscribeAll((evt) => {
      collected.push(evt);
    });
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it("walks every state transition (create → start → block → unblock → complete)", async () => {
    const created = await ctx.memory.trackTask.create({
      workspaceId: ctx.workspaceId,
      title: "Wire mem.task integration test",
      description: "End-to-end through TrackTaskUseCase.",
      priority: TaskPriority.medium(),
      tags: Tags.create(["test"]),
      dueAtMs: null,
    });
    {
      const persisted = await ctx.memory.tasks.findById(created.taskId);
      expect(persisted).not.toBeNull();
      expect(persisted?.getStatus().toString()).toBe("todo");
    }

    await ctx.memory.trackTask.start({ workspaceId: ctx.workspaceId, taskId: created.taskId });
    {
      const persisted = await ctx.memory.tasks.findById(created.taskId);
      expect(persisted?.getStatus().toString()).toBe("in_progress");
    }

    await ctx.memory.trackTask.block({ workspaceId: ctx.workspaceId, taskId: created.taskId });
    {
      const persisted = await ctx.memory.tasks.findById(created.taskId);
      expect(persisted?.getStatus().toString()).toBe("blocked");
    }

    await ctx.memory.trackTask.unblock({ workspaceId: ctx.workspaceId, taskId: created.taskId });
    {
      const persisted = await ctx.memory.tasks.findById(created.taskId);
      // unblock returns the task to `todo`; resuming work is a separate
      // `start` call (see `Task.unblock` doc and the legal-transitions
      // table in `task.ts`).
      expect(persisted?.getStatus().toString()).toBe("todo");
    }

    // Resume → start → complete (every `done` MUST come from
    // `in_progress`, see ALLOWED_TASK_TRANSITIONS).
    await ctx.memory.trackTask.start({ workspaceId: ctx.workspaceId, taskId: created.taskId });
    await ctx.memory.trackTask.complete({
      workspaceId: ctx.workspaceId,
      taskId: created.taskId,
    });
    {
      const persisted = await ctx.memory.tasks.findById(created.taskId);
      expect(persisted?.getStatus().toString()).toBe("done");
      expect(persisted?.getCompletedAt()).not.toBeNull();
    }

    // Every transition published its dedicated event.
    const eventNames = collected.map((e) => e.eventName);
    expect(eventNames).toContain("memory.task-created");
    expect(eventNames).toContain("memory.task-started");
    expect(eventNames).toContain("memory.task-blocked");
    expect(eventNames).toContain("memory.task-unblocked");
    expect(eventNames).toContain("memory.task-completed");
  });

  it("rejects illegal transitions (todo → done) with InvalidTaskTransitionError", async () => {
    const t = await ctx.memory.trackTask.create({
      workspaceId: ctx.workspaceId,
      title: "illegal-transition",
      description: null,
      priority: TaskPriority.low(),
      tags: Tags.empty(),
      dueAtMs: null,
    });
    // todo → done is forbidden (must transit through in_progress).
    await expect(
      ctx.memory.trackTask.complete({
        workspaceId: ctx.workspaceId,
        taskId: t.taskId,
      }),
    ).rejects.toMatchObject({ code: "memory.invalid-task-transition" });
  });

  it("rejects an unknown task id with MemoryApplicationError.taskNotFound", async () => {
    // `TaskId.from` accepts a canonical UUID v7; build a fabricated id
    // that is well-formed but does not exist in the DB.
    const ghostId = (await ctx.memory.trackTask.create({
      workspaceId: ctx.workspaceId,
      title: "ghost-helper",
      description: null,
      priority: TaskPriority.low(),
      tags: Tags.empty(),
      dueAtMs: null,
    })).taskId;
    // Wipe by directly deleting the row (simulates a concurrent purge).
    ctx.database.prepare("DELETE FROM tasks WHERE id = ?").run(ghostId.toString());
    await expect(
      ctx.memory.trackTask.start({
        workspaceId: ctx.workspaceId,
        taskId: ghostId,
      }),
    ).rejects.toMatchObject({ code: "memory.task-not-found" });
  });

  it("via wire facade — TrackTaskFacadeAdapter routes create/list/update", async () => {
    const create = await ctx.mcpServer.useCases.task.task({
      workspace_id: ctx.workspaceId.toString(),
      action: "create",
      title: "Wire-task",
      description: "From the wire facade.",
    });
    expect(create.action).toBe("create");
    if (create.action !== "create") return; // type narrowing

    const list = await ctx.mcpServer.useCases.task.task({
      workspace_id: ctx.workspaceId.toString(),
      action: "list",
      filter: { status: "any" },
    });
    expect(list.action).toBe("list");
    if (list.action === "list") {
      expect(list.tasks.length).toBeGreaterThan(0);
    }

    const update = await ctx.mcpServer.useCases.task.task({
      workspace_id: ctx.workspaceId.toString(),
      action: "update",
      task_id: create.task_id,
      status: "in_progress",
    });
    expect(update.action).toBe("update");
  });
});
