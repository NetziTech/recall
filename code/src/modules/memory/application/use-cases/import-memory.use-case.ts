import type { Clock } from "../../../../shared/application/ports/clock.port.ts";
import type { DatabaseConnection } from "../../../../shared/application/ports/database-connection.port.ts";
import type { Logger } from "../../../../shared/application/ports/logger.port.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { Decision } from "../../domain/aggregates/decision.ts";
import type { Entity } from "../../domain/aggregates/entity.ts";
import type { Learning } from "../../domain/aggregates/learning.ts";
import type { Relation } from "../../domain/aggregates/relation.ts";
import type { Session } from "../../domain/aggregates/session.ts";
import type { Task } from "../../domain/aggregates/task.ts";
import type { Turn } from "../../domain/aggregates/turn.ts";
import type { DecisionRepository } from "../../domain/repositories/decision-repository.ts";
import type { EntityRepository } from "../../domain/repositories/entity-repository.ts";
import type { LearningRepository } from "../../domain/repositories/learning-repository.ts";
import type { RelationRepository } from "../../domain/repositories/relation-repository.ts";
import type { SessionRepository } from "../../domain/repositories/session-repository.ts";
import type { TaskRepository } from "../../domain/repositories/task-repository.ts";
import type { TurnRepository } from "../../domain/repositories/turn-repository.ts";
import { MemoryApplicationError } from "../errors/memory-application-error.ts";
import type {
  ImportConflictStrategy,
  ImportMemory,
  ImportMemoryResult,
} from "../ports/in/import-memory.port.ts";
import type { MemoryImporter } from "../ports/out/memory-importer.port.ts";

/**
 * Per-kind statistics tracked during the import.
 */
interface ImportStats {
  inserted: number;
  skipped: number;
  replaced: number;
}

/**
 * Aggregates carry an `id` whose `toString()` is the persisted key.
 * The local helper is duck-typed to keep the import path free of a
 * cross-aggregate base interface.
 */
interface AggregateWithStringId {
  getId(): { toString(): string };
}

/**
 * Use case: parse a JSON export and persist its contents into the
 * workspace.
 *
 * Implements the `ImportMemory` driving port. The use case:
 *
 * 1. Asks the `MemoryImporter` to parse the JSON envelope into a
 *    typed `MemorySnapshot`.
 * 2. Walks each kind, applying the `conflictStrategy` (`skip`,
 *    `replace`, or `error`) on every collision.
 * 3. Persists every surviving aggregate inside a SINGLE SQLite
 *    transaction so the entire import is atomic and the per-row fsync
 *    cost is paid once at COMMIT (better-sqlite3 transactions are
 *    synchronous; the repository adapters wrap synchronous SQL in
 *    `Promise.resolve(...)` so the SQL has already run by the time
 *    each `save` returns — see
 *    `code/src/shared/application/ports/database-connection.port.ts`).
 *
 * Cross-aggregate ordering: entities BEFORE relations (FK), sessions
 * BEFORE turns (FK). The use case enforces the ordering explicitly
 * even when the underlying SQLite would surface a constraint
 * violation.
 *
 * The use case does NOT publish events for the imported aggregates:
 * an import is a state restoration, not a stream of new business
 * facts. Subscribers that observed the original events when they
 * happened on the source instance do not want a duplicate stream on
 * the target.
 *
 * Embedding re-population: the import does NOT enqueue jobs (the
 * snapshot does not carry vectors; embeddings are regenerable). The
 * curator's nightly pass detects the gap and re-queues every row
 * whose embedding is missing.
 */
export class ImportMemoryUseCase implements ImportMemory {
  public constructor(
    private readonly db: DatabaseConnection,
    private readonly importer: MemoryImporter,
    private readonly decisions: DecisionRepository,
    private readonly learnings: LearningRepository,
    private readonly entities: EntityRepository,
    private readonly tasks: TaskRepository,
    private readonly turns: TurnRepository,
    private readonly sessions: SessionRepository,
    private readonly relations: RelationRepository,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  public async import(input: {
    workspaceId: WorkspaceId;
    json: string;
    conflictStrategy: ImportConflictStrategy;
  }): Promise<ImportMemoryResult> {
    const importedAt = this.clock.now();
    const snapshot = this.importer.parse({
      json: input.json,
      workspaceId: input.workspaceId,
    });

    // Pre-compute collisions OUTSIDE the transaction. The
    // `findById(...)` calls run synchronously under the hood (the
    // adapters wrap better-sqlite3 in `Promise.resolve`) but we keep
    // them here so the awaited reads stay outside the sync
    // transaction closure, where awaits are forbidden.
    const sessionPlan = await this.planKind(
      snapshot.sessions,
      input.conflictStrategy,
      (agg) => this.sessions.findById(agg.getId()),
    );
    const turnPlan = await this.planKind(
      snapshot.turns,
      input.conflictStrategy,
      (agg) => this.turns.findById(agg.getId()),
    );
    const decisionPlan = await this.planKind(
      snapshot.decisions,
      input.conflictStrategy,
      (agg) => this.decisions.findById(agg.getId()),
    );
    const learningPlan = await this.planKind(
      snapshot.learnings,
      input.conflictStrategy,
      (agg) => this.learnings.findById(agg.getId()),
    );
    const entityPlan = await this.planKind(
      snapshot.entities,
      input.conflictStrategy,
      (agg) => this.entities.findById(agg.getId()),
    );
    const taskPlan = await this.planKind(
      snapshot.tasks,
      input.conflictStrategy,
      (agg) => this.tasks.findById(agg.getId()),
    );
    const relationPlan = await this.planKind(
      snapshot.relations,
      input.conflictStrategy,
      (agg) => this.relations.findById(agg.getId()),
    );

    // Persist EVERYTHING inside a single SQLite transaction. The
    // repository adapters return `Promise.resolve(...)` AFTER the SQL
    // has already executed, so calling `void this.repo.save(agg)` is
    // safe: the side effect happens synchronously within the
    // transaction; the returned promise is already resolved.
    this.db.transaction((): void => {
      // Sessions before turns (turns FK to sessions).
      for (const agg of sessionPlan.toPersist) void this.sessions.save(agg);
      for (const agg of turnPlan.toPersist) void this.turns.save(agg);
      for (const agg of decisionPlan.toPersist) void this.decisions.save(agg);
      for (const agg of learningPlan.toPersist) void this.learnings.save(agg);
      // Entities before relations (relations FK to entities).
      for (const agg of entityPlan.toPersist) void this.entities.save(agg);
      for (const agg of taskPlan.toPersist) void this.tasks.save(agg);
      for (const agg of relationPlan.toPersist) void this.relations.save(agg);
    });

    const counts = Object.freeze({
      decisions: decisionPlan.stats.inserted + decisionPlan.stats.replaced,
      learnings: learningPlan.stats.inserted + learningPlan.stats.replaced,
      entities: entityPlan.stats.inserted + entityPlan.stats.replaced,
      tasks: taskPlan.stats.inserted + taskPlan.stats.replaced,
      turns: turnPlan.stats.inserted + turnPlan.stats.replaced,
      sessions: sessionPlan.stats.inserted + sessionPlan.stats.replaced,
      relations: relationPlan.stats.inserted + relationPlan.stats.replaced,
    });

    const skipped =
      sessionPlan.stats.skipped +
      turnPlan.stats.skipped +
      decisionPlan.stats.skipped +
      learningPlan.stats.skipped +
      entityPlan.stats.skipped +
      taskPlan.stats.skipped +
      relationPlan.stats.skipped;
    const replaced =
      sessionPlan.stats.replaced +
      turnPlan.stats.replaced +
      decisionPlan.stats.replaced +
      learningPlan.stats.replaced +
      entityPlan.stats.replaced +
      taskPlan.stats.replaced +
      relationPlan.stats.replaced;

    this.logger.info(
      {
        workspaceId: input.workspaceId.toString(),
        importedAtMs: importedAt.epochMs,
        ...counts,
        skipped,
        replaced,
      },
      "memory import completed",
    );

    return {
      workspaceId: input.workspaceId,
      importedAtMs: importedAt.epochMs,
      counts,
      skipped,
      replaced,
    };
  }

  /**
   * Walks the supplied aggregates ONCE, queries the existing-id
   * collisions, and produces the plan + per-kind stats. The final
   * persistence happens inside the sync transaction in `import(...)`.
   */
  private async planKind<
    T extends Decision | Learning | Entity | Task | Turn | Session | Relation,
  >(
    aggregates: readonly T[],
    strategy: ImportConflictStrategy,
    finder: (aggregate: T) => Promise<unknown>,
  ): Promise<{ toPersist: readonly T[]; stats: ImportStats }> {
    const stats: ImportStats = { inserted: 0, skipped: 0, replaced: 0 };
    const toPersist: T[] = [];
    for (const agg of aggregates) {
      const existing = await finder(agg);
      const collision = existing !== null && existing !== undefined;
      if (collision && strategy === "skip") {
        stats.skipped += 1;
        continue;
      }
      if (collision && strategy === "error") {
        const aggregateId = (agg as unknown as AggregateWithStringId)
          .getId()
          .toString();
        throw MemoryApplicationError.importValidationFailed(
          `id collision for aggregate ${aggregateId} under "error" strategy`,
        );
      }
      toPersist.push(agg);
      if (collision) {
        stats.replaced += 1;
      } else {
        stats.inserted += 1;
      }
    }
    return { toPersist, stats };
  }
}
