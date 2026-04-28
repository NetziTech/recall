import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { Task } from "../../domain/aggregates/task.ts";
import type { DecisionRepository } from "../../domain/repositories/decision-repository.ts";
import type { EntityRepository } from "../../domain/repositories/entity-repository.ts";
import type { LearningRepository } from "../../domain/repositories/learning-repository.ts";
import type { RelationRepository } from "../../domain/repositories/relation-repository.ts";
import type { SessionRepository } from "../../domain/repositories/session-repository.ts";
import type { TaskRepository } from "../../domain/repositories/task-repository.ts";
import type { TurnRepository } from "../../domain/repositories/turn-repository.ts";
import type {
  MemorySnapshot,
} from "../../application/ports/out/memory-exporter.port.ts";
import type { MemorySnapshotReader } from "../../application/ports/out/memory-snapshot-reader.port.ts";
import { TaskStatus } from "../../domain/value-objects/task-status.ts";
import { MemoryInfrastructureError } from "../errors/memory-infrastructure-error.ts";

/**
 * SQLite-backed adapter for `MemorySnapshotReader`.
 *
 * Materialises every aggregate of the workspace by combining per-kind
 * reads:
 *
 * - `decisions` / `learnings` / `entities` come from the
 *   `findByWorkspace` paths of the per-kind repositories.
 * - `tasks` come from a UNION of all four task statuses.
 * - `turns` / `sessions` / `relations` come from `findAllByWorkspace`
 *   on their respective repositories — a SINGLE SQL query per kind
 *   (no N+1 id-walk). This is the difference between the export use
 *   case meeting and missing its 50K-rows-< 30 s nightly window.
 *
 * Concurrency:
 * - Every read is a prepared statement; the snapshot is built in a
 *   single pass without writes, so no transaction is needed.
 */
export class SqliteMemorySnapshotReader implements MemorySnapshotReader {
  public constructor(
    private readonly workspaceId: WorkspaceId,
    private readonly decisions: DecisionRepository,
    private readonly learnings: LearningRepository,
    private readonly entities: EntityRepository,
    private readonly tasks: TaskRepository,
    private readonly turns: TurnRepository,
    private readonly sessions: SessionRepository,
    private readonly relations: RelationRepository,
  ) {}

  public async read(input: {
    workspaceId: WorkspaceId;
  }): Promise<MemorySnapshot> {
    if (!input.workspaceId.equals(this.workspaceId)) {
      throw MemoryInfrastructureError.queryFailed(
        "memory_snapshot",
        new Error(
          `workspace mismatch: adapter pinned to ${this.workspaceId.toString()} but caller passed ${input.workspaceId.toString()}`,
        ),
      );
    }

    const allDecisions = await this.decisions.findByWorkspace(this.workspaceId);
    const allLearnings = await this.learnings.findByWorkspace(this.workspaceId);
    const allEntities = await this.entities.findByWorkspace(this.workspaceId);

    const allTasks: Task[] = [];
    for (const status of [
      TaskStatus.todo(),
      TaskStatus.inProgress(),
      TaskStatus.blocked(),
      TaskStatus.done(),
    ]) {
      const subset = await this.tasks.findByStatus(this.workspaceId, status);
      for (const t of subset) allTasks.push(t);
    }

    const allTurns = await this.turns.findAllByWorkspace(this.workspaceId);
    const allSessions = await this.sessions.findAllByWorkspace(
      this.workspaceId,
    );
    const allRelations = await this.relations.findAllByWorkspace(
      this.workspaceId,
    );

    return {
      decisions: allDecisions,
      learnings: allLearnings,
      entities: allEntities,
      tasks: Object.freeze(allTasks),
      turns: allTurns,
      sessions: allSessions,
      relations: allRelations,
    };
  }
}
