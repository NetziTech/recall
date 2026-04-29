import { z } from "zod";

import type { DatabaseConnection } from "../../../../shared/application/ports/database-connection.port.ts";
import { Tags } from "../../../../shared/domain/value-objects/tags.ts";
import { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import { Task } from "../../domain/aggregates/task.ts";
import type { TaskRepository } from "../../domain/repositories/task-repository.ts";
import { TaskDescription } from "../../domain/value-objects/task-description.ts";
import { TaskId } from "../../domain/value-objects/task-id.ts";
import { TaskPriority } from "../../domain/value-objects/task-priority.ts";
import { TaskStatus } from "../../domain/value-objects/task-status.ts";
import { TaskTitle } from "../../domain/value-objects/task-title.ts";
import { MemoryInfrastructureError } from "../errors/memory-infrastructure-error.ts";

const TaskRowSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().nullable(),
  status: z.string().min(1),
  priority: z.string().min(1),
  created_at_ms: z.number().int().min(0),
  updated_at_ms: z.number().int().min(0),
  completed_at_ms: z.number().int().min(0).nullable(),
  blocked_by_json: z.string(),
  notes_json: z.string(),
  tags_json: z.string(),
});

const TagsArraySchema = z.array(z.string().min(1));

const SQL_UPSERT = `
INSERT INTO tasks (
  id, title, description, status, priority, created_at_ms, updated_at_ms,
  completed_at_ms, blocked_by_json, notes_json, tags_json
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', '[]', ?)
ON CONFLICT(id) DO UPDATE SET
  title           = excluded.title,
  description     = excluded.description,
  status          = excluded.status,
  priority        = excluded.priority,
  updated_at_ms   = excluded.updated_at_ms,
  completed_at_ms = excluded.completed_at_ms,
  tags_json       = excluded.tags_json
`.trim();

const SQL_SELECT_BY_ID = `
SELECT id, title, description, status, priority, created_at_ms, updated_at_ms,
       completed_at_ms, blocked_by_json, notes_json, tags_json
FROM tasks
WHERE id = ?
LIMIT 1
`.trim();

const SQL_SELECT_OPEN = `
SELECT id, title, description, status, priority, created_at_ms, updated_at_ms,
       completed_at_ms, blocked_by_json, notes_json, tags_json
FROM tasks
WHERE status != 'done'
ORDER BY created_at_ms DESC, id DESC
`.trim();

const SQL_SELECT_BY_STATUS = `
SELECT id, title, description, status, priority, created_at_ms, updated_at_ms,
       completed_at_ms, blocked_by_json, notes_json, tags_json
FROM tasks
WHERE status = ?
ORDER BY created_at_ms DESC, id DESC
`.trim();

const SQL_SELECT_BY_PRIORITY = `
SELECT id, title, description, status, priority, created_at_ms, updated_at_ms,
       completed_at_ms, blocked_by_json, notes_json, tags_json
FROM tasks
WHERE priority = ?
ORDER BY created_at_ms DESC, id DESC
`.trim();

const SQL_DELETE_BY_ID = `
DELETE FROM tasks
WHERE id = ?
`.trim();

/**
 * SQLite-backed adapter for `TaskRepository`.
 *
 * Status reconciliation: `docs/03-modelo-datos.md` §4.7 lists the SQL
 * default as `'pending'`, but the domain's `TaskStatus` only knows
 * `todo | in_progress | done | blocked`. The adapter persists the
 * domain literal verbatim. When parsing rows that use the legacy
 * `'pending'` value (imported from a previous tool, an external
 * import, or the schema's column default if a row was hand-inserted),
 * the adapter normalises `'pending'` to `'todo'` so the domain
 * factory accepts it.
 */
export class SqliteTaskRepository implements TaskRepository {
  public constructor(
    private readonly db: DatabaseConnection,
    private readonly workspaceId: WorkspaceId,
  ) {}

  public async findById(id: TaskId): Promise<Task | null> {
    const stmt = this.db.prepare(SQL_SELECT_BY_ID);
    let row: unknown;
    try {
      row = stmt.get(id.toString());
    } catch (cause: unknown) {
      throw MemoryInfrastructureError.queryFailed("tasks", cause);
    }
    if (row === undefined) return Promise.resolve(null);
    return Promise.resolve(this.parseRow(row));
  }

  public async save(task: Task): Promise<void> {
    const description = task.getDescription()?.toString() ?? null;
    const completedAt = task.getCompletedAt()?.toEpochMs() ?? null;
    const tagsJson = JSON.stringify(task.getTags().toArray());

    const stmt = this.db.prepare(SQL_UPSERT);
    try {
      stmt.run(
        task.getId().toString(),
        task.getTitle().toString(),
        description,
        task.getStatus().toString(),
        task.getPriority().toString(),
        task.getCreatedAt().toEpochMs(),
        task.getUpdatedAt().toEpochMs(),
        completedAt,
        tagsJson,
      );
    } catch (cause: unknown) {
      throw MemoryInfrastructureError.upsertFailed("tasks", cause);
    }
    return Promise.resolve();
  }

  /**
   * The `TaskRepository` port returns `Promise<boolean>` for parity
   * with every other repository method (which DO need to be async to
   * await the embedder/queue). The body here happens to be synchronous
   * because better-sqlite3 is sync, but downgrading the signature to
   * `boolean` would force every caller to special-case `delete` and
   * bleed the synchronous nature of the storage layer into the use
   * case. We avoid `return Promise.resolve(...)` to satisfy SonarQube
   * S7746 ("prefer `return value` over `return Promise.resolve(value)`")
   * and silence the dual rule `require-await` here only.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  public async delete(id: TaskId): Promise<boolean> {
    const stmt = this.db.prepare(SQL_DELETE_BY_ID);
    let changes: number;
    try {
      const result = stmt.run(id.toString());
      changes = result.changes;
    } catch (cause: unknown) {
      // A failing DELETE is fundamentally a query failure (the row
      // scan failed) rather than an upsert failure (no
      // `INSERT ... ON CONFLICT` semantics involved).
      throw MemoryInfrastructureError.queryFailed("tasks", cause);
    }
    return changes > 0;
  }

  public async findOpenByWorkspace(
    workspaceId: WorkspaceId,
  ): Promise<readonly Task[]> {
    this.assertWorkspace(workspaceId);
    return this.runListQuery(SQL_SELECT_OPEN, []);
  }

  public async findByStatus(
    workspaceId: WorkspaceId,
    status: TaskStatus,
  ): Promise<readonly Task[]> {
    this.assertWorkspace(workspaceId);
    return this.runListQuery(SQL_SELECT_BY_STATUS, [status.toString()]);
  }

  public async findByPriority(
    workspaceId: WorkspaceId,
    priority: TaskPriority,
  ): Promise<readonly Task[]> {
    this.assertWorkspace(workspaceId);
    return this.runListQuery(SQL_SELECT_BY_PRIORITY, [priority.toString()]);
  }

  // -- internals --------------------------------------------------------

  private assertWorkspace(workspaceId: WorkspaceId): void {
    if (!workspaceId.equals(this.workspaceId)) {
      throw MemoryInfrastructureError.queryFailed(
        "tasks",
        new Error(
          `workspace mismatch: adapter pinned to ${this.workspaceId.toString()} but caller passed ${workspaceId.toString()}`,
        ),
      );
    }
  }

  private async runListQuery(
    sql: string,
    params: readonly unknown[],
  ): Promise<readonly Task[]> {
    const stmt = this.db.prepare(sql);
    let rows: readonly unknown[];
    try {
      rows = stmt.all(...params);
    } catch (cause: unknown) {
      throw MemoryInfrastructureError.queryFailed("tasks", cause);
    }
    const out: Task[] = [];
    for (const raw of rows) {
      out.push(this.parseRow(raw));
    }
    return Promise.resolve(Object.freeze(out));
  }

  private parseRow(raw: unknown): Task {
    let parsed: z.infer<typeof TaskRowSchema>;
    try {
      parsed = TaskRowSchema.parse(raw);
    } catch (cause: unknown) {
      throw MemoryInfrastructureError.rowMalformed(
        "tasks",
        cause instanceof Error ? cause.message : "schema parse failed",
        cause,
      );
    }
    const status = SqliteTaskRepository.normaliseStatus(parsed.status);
    const description =
      parsed.description === null || parsed.description.length === 0
        ? null
        : TaskDescription.from(parsed.description);
    const tags = SqliteTaskRepository.parseTags(parsed.tags_json);
    const createdAt = Timestamp.fromEpochMs(parsed.created_at_ms);
    const updatedAt = Timestamp.fromEpochMs(parsed.updated_at_ms);
    const completedAt =
      parsed.completed_at_ms === null
        ? null
        : Timestamp.fromEpochMs(parsed.completed_at_ms);
    return Task.rehydrate({
      id: TaskId.from(parsed.id),
      workspaceId: this.workspaceId,
      sessionId: null,
      title: TaskTitle.from(parsed.title),
      description,
      status,
      priority: TaskPriority.create(parsed.priority),
      tags,
      dueAt: null,
      createdAt,
      updatedAt,
      completedAt,
    });
  }

  private static normaliseStatus(raw: string): TaskStatus {
    // Legacy compatibility: rows that arrived from a `'pending'`
    // default get translated to `todo` so the domain factory accepts
    // them. The reverse (writing) is unnecessary because the domain
    // never produces `pending`.
    const trimmed = raw.trim();
    if (trimmed === "pending") return TaskStatus.todo();
    return TaskStatus.create(trimmed);
  }

  private static parseTags(rawJson: string): Tags {
    try {
      const decoded = JSON.parse(rawJson) as unknown;
      const validated = TagsArraySchema.parse(decoded);
      if (validated.length === 0) return Tags.empty();
      return Tags.create(validated);
    } catch (cause: unknown) {
      throw MemoryInfrastructureError.rowMalformed(
        "tasks",
        `tags_json could not be decoded: ${cause instanceof Error ? cause.message : "unknown"}`,
        cause,
      );
    }
  }
}
