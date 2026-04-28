import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteTaskRepository } from "../../../../src/modules/memory/infrastructure/persistence/sqlite-task-repository.ts";
import { Task } from "../../../../src/modules/memory/domain/aggregates/task.ts";
import { TaskId } from "../../../../src/modules/memory/domain/value-objects/task-id.ts";
import { TaskTitle } from "../../../../src/modules/memory/domain/value-objects/task-title.ts";
import { TaskPriority } from "../../../../src/modules/memory/domain/value-objects/task-priority.ts";
import { TaskStatus } from "../../../../src/modules/memory/domain/value-objects/task-status.ts";
import { WorkspaceId } from "../../../../src/shared/domain/value-objects/workspace-id.ts";
import { newMemoryDatabase } from "../../../_fixtures/memory-database.ts";
import {
  ANCHOR_TIME_MS,
  FIXED_TASK_UUID,
  makeTags,
  makeTimestamp,
  makeWorkspaceId,
} from "../../../helpers/factories.ts";

const SECOND_TASK_UUID = "01952f3c-2222-7000-8000-aaaaaaaaaa02";
const OTHER_WS = "01952f3c-2222-7000-8000-aaaaaaaaaa99";

interface Ctx {
  db: Awaited<ReturnType<typeof newMemoryDatabase>>;
  repo: SqliteTaskRepository;
}
let ctx: Ctx;

beforeEach(async () => {
  const db = await newMemoryDatabase();
  ctx = { db, repo: new SqliteTaskRepository(db, makeWorkspaceId()) };
});
afterEach(() => {
  ctx.db.close();
});

function buildTask(args: {
  id: string;
  priority?: TaskPriority;
  occurredAtMs?: number;
}): Task {
  const t = Task.create({
    id: TaskId.from(args.id),
    workspaceId: makeWorkspaceId(),
    sessionId: null,
    title: TaskTitle.from(`T-${args.id.slice(-4)}`),
    description: null,
    priority: args.priority ?? TaskPriority.medium(),
    tags: makeTags(),
    dueAt: null,
    occurredAt: makeTimestamp(args.occurredAtMs ?? ANCHOR_TIME_MS),
  });
  t.pullEvents();
  return t;
}

describe("SqliteTaskRepository CRUD", () => {
  it("save+findById round-trips status and priority", async () => {
    await ctx.repo.save(
      buildTask({ id: FIXED_TASK_UUID, priority: TaskPriority.high() }),
    );
    const loaded = await ctx.repo.findById(TaskId.from(FIXED_TASK_UUID));
    expect(loaded?.getStatus().isTodo()).toBe(true);
    expect(loaded?.getPriority().toString()).toBe("high");
  });

  it("persists status transitions through upsert", async () => {
    const t = buildTask({ id: FIXED_TASK_UUID });
    await ctx.repo.save(t);
    t.start({ occurredAt: makeTimestamp(ANCHOR_TIME_MS + 1) });
    await ctx.repo.save(t);
    const loaded = await ctx.repo.findById(TaskId.from(FIXED_TASK_UUID));
    expect(loaded?.getStatus().isInProgress()).toBe(true);
  });

  it("findById returns null on miss", async () => {
    expect(await ctx.repo.findById(TaskId.from(FIXED_TASK_UUID))).toBe(null);
  });

  it("delete removes the row and returns true", async () => {
    const t = buildTask({ id: FIXED_TASK_UUID });
    await ctx.repo.save(t);
    const before = await ctx.repo.findById(TaskId.from(FIXED_TASK_UUID));
    expect(before).not.toBe(null);
    const removed = await ctx.repo.delete(TaskId.from(FIXED_TASK_UUID));
    expect(removed).toBe(true);
    const after = await ctx.repo.findById(TaskId.from(FIXED_TASK_UUID));
    expect(after).toBe(null);
  });

  it("delete returns false when no row exists (idempotent)", async () => {
    const removed = await ctx.repo.delete(TaskId.from(FIXED_TASK_UUID));
    expect(removed).toBe(false);
  });

  it("delete leaves other rows untouched", async () => {
    await ctx.repo.save(buildTask({ id: FIXED_TASK_UUID }));
    await ctx.repo.save(
      buildTask({ id: SECOND_TASK_UUID, occurredAtMs: ANCHOR_TIME_MS + 100 }),
    );
    await ctx.repo.delete(TaskId.from(FIXED_TASK_UUID));
    const survivor = await ctx.repo.findById(TaskId.from(SECOND_TASK_UUID));
    expect(survivor).not.toBe(null);
    expect(survivor?.getId().toString()).toBe(SECOND_TASK_UUID);
  });
});

describe("SqliteTaskRepository queries", () => {
  it("findOpenByWorkspace excludes done tasks", async () => {
    const t1 = buildTask({ id: FIXED_TASK_UUID });
    const t2 = buildTask({ id: SECOND_TASK_UUID });
    await ctx.repo.save(t1);
    await ctx.repo.save(t2);
    t2.start({ occurredAt: makeTimestamp(ANCHOR_TIME_MS + 1) });
    t2.complete({ occurredAt: makeTimestamp(ANCHOR_TIME_MS + 2) });
    await ctx.repo.save(t2);
    const open = await ctx.repo.findOpenByWorkspace(makeWorkspaceId());
    expect(open.length).toBe(1);
    expect(open[0]?.getId().toString()).toBe(FIXED_TASK_UUID);
  });

  it("findByStatus returns only matching status", async () => {
    const t = buildTask({ id: FIXED_TASK_UUID });
    await ctx.repo.save(t);
    t.start({ occurredAt: makeTimestamp(ANCHOR_TIME_MS + 1) });
    await ctx.repo.save(t);
    const inProgress = await ctx.repo.findByStatus(
      makeWorkspaceId(),
      TaskStatus.inProgress(),
    );
    expect(inProgress.length).toBe(1);
  });

  it("findByPriority filters by priority literal", async () => {
    await ctx.repo.save(
      buildTask({ id: FIXED_TASK_UUID, priority: TaskPriority.low() }),
    );
    await ctx.repo.save(
      buildTask({
        id: SECOND_TASK_UUID,
        priority: TaskPriority.high(),
        occurredAtMs: ANCHOR_TIME_MS + 100,
      }),
    );
    const high = await ctx.repo.findByPriority(
      makeWorkspaceId(),
      TaskPriority.high(),
    );
    expect(high.length).toBe(1);
    expect(high[0]?.getId().toString()).toBe(SECOND_TASK_UUID);
  });

  it("rejects mismatched workspace on findOpenByWorkspace", async () => {
    await expect(
      ctx.repo.findOpenByWorkspace(WorkspaceId.from(OTHER_WS)),
    ).rejects.toMatchObject({
      code: "memory.persistence.query-failed",
    });
  });

  it("rejects rows with malformed tags_json", async () => {
    ctx.db.exec(
      `INSERT INTO tasks (id, title, status, priority, created_at_ms, updated_at_ms, blocked_by_json, notes_json, tags_json) VALUES ('${FIXED_TASK_UUID}', 'T', 'todo', 'medium', ${String(ANCHOR_TIME_MS)}, ${String(ANCHOR_TIME_MS)}, '[]', '[]', 'not-json')`,
    );
    await expect(
      ctx.repo.findById(TaskId.from(FIXED_TASK_UUID)),
    ).rejects.toMatchObject({ code: "memory.persistence.row-malformed" });
  });

  it("normalises legacy 'pending' status to 'todo' on read", async () => {
    // Hand-write a row with 'pending' (the schema default) to verify
    // the adapter's defensive normalisation kicks in (B-010 mitigation).
    ctx.db.exec(
      `INSERT INTO tasks (id, title, status, priority, created_at_ms, updated_at_ms, blocked_by_json, notes_json, tags_json) VALUES ('${SECOND_TASK_UUID}', 'pendingrow', 'pending', 'medium', ${String(ANCHOR_TIME_MS)}, ${String(ANCHOR_TIME_MS)}, '[]', '[]', '[]')`,
    );
    const loaded = await ctx.repo.findById(TaskId.from(SECOND_TASK_UUID));
    expect(loaded?.getStatus().isTodo()).toBe(true);
  });
});
