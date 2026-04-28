/**
 * Public surface of `modules/curator/infrastructure/`.
 *
 * Mirrors the pattern adopted by `secrets/infrastructure/index.ts` and
 * `shared/infrastructure/index.ts`: re-exports the concrete adapters
 * so the composition root can wire them with their ports in one
 * place.
 */

export { SqliteCuratorRunRepository } from "./persistence/sqlite-curator-run-repository.ts";
export { SqlitePrunedEntryRepository } from "./persistence/sqlite-pruned-entry-repository.ts";
export { SqliteMemoryEntryReader } from "./persistence/sqlite-memory-entry-reader.ts";
export { SqliteMemoryEntryWriter } from "./persistence/sqlite-memory-entry-writer.ts";
export { SqliteSessionRollupReader } from "./persistence/sqlite-session-rollup-reader.ts";

export { Vec0SimilarityFinder } from "./similarity/vec0-similarity-finder.ts";

export { NodeFilesystemChecker } from "./filesystem/node-filesystem-checker.ts";

export { IntervalCuratorScheduler } from "./scheduler/interval-curator-scheduler.ts";
export type { IntervalCuratorSchedulerOptions } from "./scheduler/interval-curator-scheduler.ts";

export { CuratorInfrastructureError } from "./errors/curator-infrastructure-error.ts";
export type { CuratorInfrastructureErrorCode } from "./errors/curator-infrastructure-error.ts";
