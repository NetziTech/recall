/**
 * Public surface of `modules/memory/infrastructure/persistence/`.
 *
 * Re-exports every concrete adapter so the composition root can wire
 * them with a single barrel import.
 */

export { SqliteDecisionRepository } from "./sqlite-decision-repository.ts";
export { SqliteEntityRepository } from "./sqlite-entity-repository.ts";
export { SqliteLearningRepository } from "./sqlite-learning-repository.ts";
export { SqliteMemorySnapshotReader } from "./sqlite-memory-snapshot-reader.ts";
export { SqliteMemoryStatsReader } from "./sqlite-memory-stats-reader.ts";
export { SqliteMemoryWiper } from "./sqlite-memory-wiper.ts";
export { SqliteRelationRepository } from "./sqlite-relation-repository.ts";
export { SqliteSessionRepository } from "./sqlite-session-repository.ts";
export { SqliteTaskRepository } from "./sqlite-task-repository.ts";
export { SqliteTurnRepository } from "./sqlite-turn-repository.ts";
