import type { DetectorName } from "../value-objects/detector-name.ts";
import type { SecretPattern } from "../value-objects/secret-pattern.ts";

/**
 * Driven port (output port) for the catalog of regex-based secret
 * detectors.
 *
 * The concrete implementation (built-in regexes from
 * `docs/11-seguridad-modos.md` §6 + user-supplied `extra_patterns` from
 * `.recall/config.json`) lives in `infrastructure/`. The domain
 * only knows the contract:
 *
 * - `getPatterns()` returns the FULL set of patterns the scanner
 *   should run. The order is stable across calls so the matcher can
 *   produce deterministic findings.
 * - `getPattern(name)` resolves a single pattern by its `DetectorName`.
 *   Returns `null` (NOT a thrown error) when the name does not exist
 *   in the registry, mirroring the repository convention adopted
 *   elsewhere in the codebase (e.g. `WorkspaceRepository.findById`).
 *
 * Contract:
 * - The returned `readonly SecretPattern[]` is frozen by the adapter.
 *   Callers MUST NOT cast it to a mutable array.
 * - The registry is INSPECTED frequently (every scan). Implementations
 *   should keep the hot path allocation-free; if hot-reload is
 *   required, adopt a swap-pointer strategy rather than rebuilding the
 *   array on every call.
 */
export interface PatternRegistry {
  getPatterns(): readonly SecretPattern[];
  getPattern(name: DetectorName): SecretPattern | null;
}
