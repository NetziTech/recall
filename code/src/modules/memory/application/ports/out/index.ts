/**
 * Public surface of `modules/memory/application/ports/out/`.
 *
 * Re-exports every driven (output) port the memory module declares
 * locally. Cross-module shared ports (`Logger`, `Clock`,
 * `IdGenerator`, `EventPublisher`, `DatabaseConnection`,
 * `Embedder`) live in `shared/application/ports/` and are imported
 * directly from there by use cases.
 *
 * The repository ports themselves
 * (`DecisionRepository`, `LearningRepository`, ...) are defined in
 * `domain/repositories/` per Hexagonal: they belong to the domain
 * because they speak in aggregates. Use cases import them from there.
 */

export type {
  EmbeddingEnqueuer,
  EmbeddableKind,
} from "./embedding-enqueuer.port.ts";
export type {
  HandoffParser,
  ParsedHandoff,
  ParsedHandoffDecision,
  ParsedHandoffLearning,
  ParsedHandoffTask,
} from "./handoff-parser.port.ts";
export type { MemoryExporter, MemorySnapshot } from "./memory-exporter.port.ts";
export type { MemoryImporter } from "./memory-importer.port.ts";
export type { MemorySnapshotReader } from "./memory-snapshot-reader.port.ts";
export type {
  MemoryCounts,
  MemoryStatsReader,
  MemoryStatsSnapshot,
} from "./memory-stats-reader.port.ts";
export type { MemoryWiper, MemoryWipeOutcome } from "./memory-wiper.port.ts";
