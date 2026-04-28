/**
 * Wires the `curator` module: the five sub-use-cases plus the
 * orchestrator (`RunCuratorUseCase`).
 *
 * Memory-module dependencies:
 *   - `LearningRepository` and `SessionRepository` are injected from
 *     the `MemoryWiring` bag (the SQLite adapters of the memory
 *     module). Tarea 4.7 closed the previous `Pending*` gap by
 *     wiring the real repositories.
 *
 * The `Vec0SimilarityFinder` adapter receives the SAME database
 * connection as the rest of the wiring; the workspace MVP keeps
 * `recall.db` and `vectors.db` in the same SQLite file (per
 * `docs/03 §1`), so a single `DatabaseConnection` covers both.
 */

import type { DatabaseConnection } from "../../shared/application/ports/database-connection.port.ts";
import type { Clock } from "../../shared/application/ports/clock.port.ts";
import type { IdGenerator } from "../../shared/application/ports/id-generator.port.ts";
import type { Logger } from "../../shared/application/ports/logger.port.ts";
import { ApplyDecayUseCase } from "../../modules/curator/application/use-cases/apply-decay.use-case.ts";
import { ConsolidateSimilarUseCase } from "../../modules/curator/application/use-cases/consolidate-similar.use-case.ts";
import { PruneLowConfidenceUseCase } from "../../modules/curator/application/use-cases/prune-low-confidence.use-case.ts";
import { RollupSessionUseCase } from "../../modules/curator/application/use-cases/rollup-session.use-case.ts";
import { RunCuratorUseCase } from "../../modules/curator/application/use-cases/run-curator.use-case.ts";
import { SelfHealUseCase } from "../../modules/curator/application/use-cases/self-heal.use-case.ts";
import type { LearningRepository } from "../../modules/memory/domain/repositories/learning-repository.ts";
import type { SessionRepository } from "../../modules/memory/domain/repositories/session-repository.ts";
import {
  NodeFilesystemChecker,
  SqliteCuratorRunRepository,
  SqliteMemoryEntryReader,
  SqliteMemoryEntryWriter,
  SqlitePrunedEntryRepository,
  SqliteSessionRollupReader,
  Vec0SimilarityFinder,
} from "../../modules/curator/infrastructure/index.ts";

/**
 * Bag of curator use cases the rest of composition consumes via the
 * CLI's curator handlers and the (future) scheduler.
 */
export interface CuratorWiring {
  readonly runCurator: RunCuratorUseCase;
  readonly applyDecay: ApplyDecayUseCase;
  readonly consolidateSimilar: ConsolidateSimilarUseCase;
  readonly pruneLowConfidence: PruneLowConfidenceUseCase;
  readonly rollupSession: RollupSessionUseCase;
  readonly selfHeal: SelfHealUseCase;
  readonly curatorRuns: SqliteCuratorRunRepository;
}

export interface CuratorWiringOptions {
  readonly logger: Logger;
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
  readonly database: DatabaseConnection;
  /**
   * Canonical absolute root of the workspace (the directory holding
   * `.recall/`). The filesystem checker resolves stale paths
   * relative to this root.
   */
  readonly workspaceRoot: string;
  /**
   * Memory-module repositories the curator pipeline consumes
   * (`ConsolidateSimilarUseCase` calls `learnings.findById`,
   * `RollupSessionUseCase` calls `sessions.findById`, etc.).
   */
  readonly learningRepository: LearningRepository;
  readonly sessionRepository: SessionRepository;
}

/**
 * Builds the curator wiring with the canonical adapters.
 */
export function buildCuratorWiring(options: CuratorWiringOptions): CuratorWiring {
  const reader = new SqliteMemoryEntryReader(options.database);
  const writer = new SqliteMemoryEntryWriter(options.database);
  const curatorRuns = new SqliteCuratorRunRepository(options.database);
  const prunedRepo = new SqlitePrunedEntryRepository(options.database);
  const sessionRollupReader = new SqliteSessionRollupReader(options.database);
  const similarityFinder = new Vec0SimilarityFinder(options.database, options.logger);
  const filesystemChecker = new NodeFilesystemChecker(
    options.workspaceRoot,
    options.logger,
  );

  // Memory-module repositories supplied by `MemoryWiring`.
  const learningRepository = options.learningRepository;
  const sessionRepository = options.sessionRepository;

  const applyDecay = new ApplyDecayUseCase(
    reader,
    writer,
    options.clock,
    options.logger,
  );
  const consolidateSimilar = new ConsolidateSimilarUseCase(
    learningRepository,
    similarityFinder,
    curatorRuns,
    prunedRepo,
    options.clock,
    options.logger,
  );
  const pruneLowConfidence = new PruneLowConfidenceUseCase(
    reader,
    writer,
    prunedRepo,
    curatorRuns,
    options.clock,
    options.logger,
  );
  const rollupSession = new RollupSessionUseCase(
    sessionRepository,
    sessionRollupReader,
    options.clock,
    options.logger,
  );
  const selfHeal = new SelfHealUseCase(
    reader,
    writer,
    filesystemChecker,
    curatorRuns,
    options.clock,
    options.logger,
  );

  const runCurator = new RunCuratorUseCase(
    curatorRuns,
    rollupSession,
    applyDecay,
    consolidateSimilar,
    selfHeal,
    pruneLowConfidence,
    options.idGenerator,
    options.clock,
    options.logger,
  );

  return {
    runCurator,
    applyDecay,
    consolidateSimilar,
    pruneLowConfidence,
    rollupSession,
    selfHeal,
    curatorRuns,
  };
}
