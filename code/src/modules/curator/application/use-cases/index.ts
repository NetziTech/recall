/**
 * Public surface of `modules/curator/application/use-cases/`.
 *
 * Mirrors the `secrets/application/use-cases/index.ts` pattern: a
 * single barrel that exposes every use case so the composition root
 * can wire them in one import statement.
 */

export { ApplyDecayUseCase } from "./apply-decay.use-case.ts";
export { ConsolidateSimilarUseCase } from "./consolidate-similar.use-case.ts";
export { PruneLowConfidenceUseCase } from "./prune-low-confidence.use-case.ts";
export { RollupSessionUseCase } from "./rollup-session.use-case.ts";
export { RunCuratorUseCase } from "./run-curator.use-case.ts";
export { SelfHealUseCase } from "./self-heal.use-case.ts";
