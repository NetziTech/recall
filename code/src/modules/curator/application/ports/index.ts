/**
 * Public surface of `modules/curator/application/ports/`.
 *
 * Mirrors the `secrets/application/ports/index.ts` and
 * `mcp-server/application/ports/index.ts` patterns: a single barrel
 * that exposes every port (in/out) so the composition root can wire
 * them in one import statement.
 *
 * Driven ports already declared in `domain/` (the source of truth for
 * `ConsolidationDetector`, `PathChecker`, `EntryCollector`,
 * `CuratorRunRepository`, `PrunedEntryRepository`) are NOT
 * re-exported here: their natural home is the domain because the
 * aggregates and services consume them directly. Only ports that are
 * exclusively application-layer concerns live under
 * `application/ports/out/`.
 */

// driving (input) ports
export type {
  ApplyDecay,
  ApplyDecayResult,
} from "./in/apply-decay.port.ts";
export type {
  ConsolidateSimilar,
  ConsolidateSimilarResult,
} from "./in/consolidate-similar.port.ts";
export type {
  PruneLowConfidence,
  PruneLowConfidenceResult,
} from "./in/prune-low-confidence.port.ts";
export type {
  RollupSession,
  RollupSessionResult,
} from "./in/rollup-session.port.ts";
export type {
  RunCurator,
  RunCuratorResult,
} from "./in/run-curator.port.ts";
export type {
  SelfHeal,
  SelfHealResult,
} from "./in/self-heal.port.ts";

// driven (output) ports
export type {
  EntityLocationProjection,
  MemoryEntryProjection,
  MemoryEntryReader,
} from "./out/memory-entry-reader.port.ts";
export type { MemoryEntryWriter } from "./out/memory-entry-writer.port.ts";
export type {
  ConsolidationCandidate,
  SimilarityFinder,
  SimilarityPair,
} from "./out/similarity-finder.port.ts";
export type { FilesystemChecker } from "./out/filesystem-checker.port.ts";
export type {
  SessionRollupReader,
  TurnRollupProjection,
} from "./out/session-rollup-reader.port.ts";
