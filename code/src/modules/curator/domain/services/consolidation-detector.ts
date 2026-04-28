import type { Learning } from "../../../memory/domain/aggregates/learning.ts";
import type { ConsolidationPair } from "../value-objects/consolidation-pair.ts";
import type { ConsolidationThreshold } from "../value-objects/consolidation-threshold.ts";

/**
 * Driven port (output port) for the curator's semantic-consolidation
 * detector.
 *
 * The detector receives the set of active learnings the curator wants
 * to inspect plus the cosine threshold above which two learnings
 * should be considered fusion candidates, and returns the resulting
 * `ConsolidationPair`s. The actual cosine computation requires an
 * `Embedder` and a similarity primitive that live in
 * `infrastructure/`; the curator domain only knows the contract.
 *
 * Contract:
 * - `findConsolidations(learnings, threshold)` returns every
 *   ordered, non-self-pair whose cosine similarity is strictly
 *   greater than `threshold.toNumber()`.
 * - The order of returned pairs is unspecified. Callers (the
 *   application layer's curator orchestrator) iterate them to
 *   record findings on the `CuratorRun` aggregate.
 * - The detector is responsible for picking the "winner" / "loser"
 *   based on the heuristic in `docs/05-memoria-decay.md` §3
 *   (`score = use_count + confidence`). The pair construction
 *   requires the `Learning` aggregate's metadata, which is why the
 *   port accepts `Learning` directly instead of an opaque
 *   reference.
 * - Implementations MUST NOT mutate the supplied learnings.
 *
 * Performance:
 * - Per `docs/05-memoria-decay.md` §3, the algorithm is O(n²)
 *   bounded to <500 candidates per pass. Implementations may apply
 *   their own bound (early exit, locality-sensitive hashing) but
 *   MUST honour the threshold contract for any pair they do
 *   evaluate.
 */
export interface ConsolidationDetector {
  findConsolidations(
    learnings: readonly Learning[],
    threshold: ConsolidationThreshold,
  ): Promise<readonly ConsolidationPair[]>;
}
