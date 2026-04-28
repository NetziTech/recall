/**
 * Wires the `memory` module: the seven SQLite repositories
 * (`Decision/Learning/Entity/Task/Turn/Session/Relation`), the three
 * read-side adapters (`MemorySnapshotReader`, `MemoryStatsReader`,
 * `MemoryWiper`), the `EmbeddingEnqueuer`, the import/export adapters
 * (`JsonMemoryExporter`, `JsonMemoryImporter`, `MarkdownHandoffParser`),
 * the `SessionContextHelper` (internal collaborator), and the 14
 * driving use cases.
 *
 * Why a dedicated wiring file (and not an inline block in
 * `container.ts`):
 * - The memory module exposes 14 use cases that share a tight DI
 *   graph (every write use case takes the same `EmbeddingEnqueuer`,
 *   `IdGenerator`, `Clock`, `EventPublisher`, and `Logger`). A
 *   dedicated file keeps the wiring linear and reviewable.
 * - The `WorkspaceId` for every repository is supplied at composition
 *   time. The composition root's caller (the bootstrap entrypoint)
 *   detects the workspace path and resolves the canonical id BEFORE
 *   building the container.
 *
 * The wiring is `async` to a no-op extent — every adapter is sync to
 * construct. Returning a `Promise<MemoryWiring>` would buy nothing;
 * the function stays sync.
 *
 * Memory module gap closure:
 * - `composition/persistence/pending-memory-repositories.ts` is
 *   removed in Tarea 4.7. Curator's `RollupSessionUseCase` and
 *   `ConsolidateSimilarUseCase` now receive the real
 *   `SqliteSessionRepository` and `SqliteLearningRepository` from
 *   this wiring's bag; the composition root threads them through.
 */

import type { DatabaseConnection } from "../../shared/application/ports/database-connection.port.ts";
import type { Clock } from "../../shared/application/ports/clock.port.ts";
import type { EventPublisher } from "../../shared/application/ports/event-publisher.port.ts";
import type { IdGenerator } from "../../shared/application/ports/id-generator.port.ts";
import type { Logger } from "../../shared/application/ports/logger.port.ts";
import type { WorkspaceId } from "../../shared/domain/value-objects/workspace-id.ts";
import {
  AuditMemoryUseCase,
  EndSessionUseCase,
  ExportMemoryUseCase,
  ImportHandoffUseCase,
  ImportMemoryUseCase,
  RecordDecisionUseCase,
  RecordEntityUseCase,
  RecordLearningUseCase,
  RecordRelationUseCase,
  RecordTurnUseCase,
  SessionContextHelper,
  StartSessionUseCase,
  StatsMemoryUseCase,
  TrackTaskUseCase,
  WipeMemoryUseCase,
} from "../../modules/memory/application/use-cases/index.ts";
import type { DecisionRepository } from "../../modules/memory/domain/repositories/decision-repository.ts";
import type { EntityRepository } from "../../modules/memory/domain/repositories/entity-repository.ts";
import type { LearningRepository } from "../../modules/memory/domain/repositories/learning-repository.ts";
import type { RelationRepository } from "../../modules/memory/domain/repositories/relation-repository.ts";
import type { SessionRepository } from "../../modules/memory/domain/repositories/session-repository.ts";
import type { TaskRepository } from "../../modules/memory/domain/repositories/task-repository.ts";
import type { TurnRepository } from "../../modules/memory/domain/repositories/turn-repository.ts";
import {
  JsonMemoryExporter,
  JsonMemoryImporter,
  MarkdownHandoffParser,
  SqliteDecisionRepository,
  SqliteEmbeddingEnqueuer,
  SqliteEntityRepository,
  SqliteLearningRepository,
  SqliteMemorySnapshotReader,
  SqliteMemoryStatsReader,
  SqliteMemoryWiper,
  SqliteRelationRepository,
  SqliteSessionRepository,
  SqliteTaskRepository,
  SqliteTurnRepository,
} from "../../modules/memory/infrastructure/index.ts";

/**
 * Bag of memory-module use cases the rest of composition consumes via
 * the mcp-server facades (`mem.remember`, `mem.task`) and the CLI
 * facades (`audit`, `stats`, `export`, `import`, `wipe`,
 * `import-handoff`).
 *
 * The repositories are exposed too so the curator wiring can inject
 * `LearningRepository` / `SessionRepository` (closing the previous
 * `PendingLearningRepository` / `PendingSessionRepository` gap).
 */
export interface MemoryWiring {
  // Use cases.
  readonly recordDecision: RecordDecisionUseCase;
  readonly recordLearning: RecordLearningUseCase;
  readonly recordEntity: RecordEntityUseCase;
  readonly recordRelation: RecordRelationUseCase;
  readonly recordTurn: RecordTurnUseCase;
  readonly trackTask: TrackTaskUseCase;
  readonly startSession: StartSessionUseCase;
  readonly endSession: EndSessionUseCase;
  readonly auditMemory: AuditMemoryUseCase;
  readonly exportMemory: ExportMemoryUseCase;
  readonly importMemory: ImportMemoryUseCase;
  readonly importHandoff: ImportHandoffUseCase;
  readonly statsMemory: StatsMemoryUseCase;
  readonly wipeMemory: WipeMemoryUseCase;

  // Repositories (re-exported so curator wiring + facades can reuse).
  readonly decisions: DecisionRepository;
  readonly learnings: LearningRepository;
  readonly entities: EntityRepository;
  readonly tasks: TaskRepository;
  readonly turns: TurnRepository;
  readonly sessions: SessionRepository;
  readonly relations: RelationRepository;
}

export interface MemoryWiringOptions {
  readonly logger: Logger;
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
  readonly eventPublisher: EventPublisher;
  readonly database: DatabaseConnection;
  /**
   * Canonical id of the workspace whose `recall.db` is wired here.
   * Pinned at construction so every repository / reader / wiper
   * defends against cross-workspace queries.
   */
  readonly workspaceId: WorkspaceId;
}

/**
 * Builds the memory wiring. Every adapter is sync to construct; the
 * function is sync to keep the boot path tight.
 */
export function buildMemoryWiring(options: MemoryWiringOptions): MemoryWiring {
  const {
    logger,
    clock,
    idGenerator,
    eventPublisher,
    database,
    workspaceId,
  } = options;

  // Repositories. Workspace scoping pinned at construction.
  const decisions = new SqliteDecisionRepository(database, workspaceId);
  const learnings = new SqliteLearningRepository(database, workspaceId);
  const entities = new SqliteEntityRepository(database, workspaceId);
  const tasks = new SqliteTaskRepository(database, workspaceId);
  const turns = new SqliteTurnRepository(database, workspaceId);
  const sessions = new SqliteSessionRepository(database, workspaceId);
  const relations = new SqliteRelationRepository(database, workspaceId);

  // Read-side adapters.
  const snapshotReader = new SqliteMemorySnapshotReader(
    workspaceId,
    decisions,
    learnings,
    entities,
    tasks,
    turns,
    sessions,
    relations,
  );
  const statsReader = new SqliteMemoryStatsReader(database, workspaceId);
  const wiper = new SqliteMemoryWiper(database, workspaceId);

  // Embedding enqueuer.
  const enqueuer = new SqliteEmbeddingEnqueuer(database, idGenerator);

  // Import / export adapters.
  const exporter = new JsonMemoryExporter();
  const importer = new JsonMemoryImporter();
  const handoffParser = new MarkdownHandoffParser();

  // Internal session helper. Used by `RecordTurn` and
  // `TrackTask.create` to attach writes to the current session.
  const sessionHelper = new SessionContextHelper(
    sessions,
    clock,
    idGenerator,
    eventPublisher,
  );

  // Use cases.
  const recordDecision = new RecordDecisionUseCase(
    decisions,
    enqueuer,
    idGenerator,
    clock,
    eventPublisher,
    logger,
  );
  const recordLearning = new RecordLearningUseCase(
    learnings,
    enqueuer,
    idGenerator,
    clock,
    eventPublisher,
    logger,
  );
  const recordEntity = new RecordEntityUseCase(
    entities,
    enqueuer,
    idGenerator,
    clock,
    eventPublisher,
    logger,
  );
  const recordRelation = new RecordRelationUseCase(
    relations,
    entities,
    idGenerator,
    clock,
    eventPublisher,
  );
  const recordTurn = new RecordTurnUseCase(
    turns,
    sessions,
    sessionHelper,
    enqueuer,
    idGenerator,
    clock,
    eventPublisher,
    logger,
  );
  const trackTask = new TrackTaskUseCase(
    tasks,
    sessionHelper,
    idGenerator,
    clock,
    eventPublisher,
  );
  const startSession = new StartSessionUseCase(
    sessions,
    idGenerator,
    clock,
    eventPublisher,
  );
  const endSession = new EndSessionUseCase(sessions, clock, eventPublisher);

  const auditMemory = new AuditMemoryUseCase(
    decisions,
    learnings,
    entities,
    tasks,
    relations,
    clock,
    logger,
  );
  const exportMemory = new ExportMemoryUseCase(
    snapshotReader,
    exporter,
    clock,
    logger,
  );
  const importMemory = new ImportMemoryUseCase(
    database,
    importer,
    decisions,
    learnings,
    entities,
    tasks,
    turns,
    sessions,
    relations,
    clock,
    logger,
  );
  const importHandoff = new ImportHandoffUseCase(
    database,
    handoffParser,
    decisions,
    learnings,
    tasks,
    idGenerator,
    clock,
    logger,
  );
  const statsMemory = new StatsMemoryUseCase(statsReader, logger);
  const wipeMemory = new WipeMemoryUseCase(wiper, clock, logger);

  return {
    recordDecision,
    recordLearning,
    recordEntity,
    recordRelation,
    recordTurn,
    trackTask,
    startSession,
    endSession,
    auditMemory,
    exportMemory,
    importMemory,
    importHandoff,
    statsMemory,
    wipeMemory,
    decisions,
    learnings,
    entities,
    tasks,
    turns,
    sessions,
    relations,
  };
}
