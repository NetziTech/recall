import type { WorkspaceId } from "../../../../../shared/domain/value-objects/workspace-id.ts";
import type { CuratorRunId } from "../../../domain/value-objects/curator-run-id.ts";

/**
 * Outcome of one `ApplyDecay` invocation.
 *
 * `entriesScanned` includes every active entry inspected during the
 * pass (across all kinds the curator decays). `entriesDecayed` is the
 * subset whose confidence actually changed (i.e. excludes entries
 * pinned to a no-decay factor like `task` or `learning (critical)`,
 * and entries with `daysSinceLastUsed === 0`).
 *
 * The use case returns this DTO so the orchestrator
 * (`RunFullPassUseCase`) can fold it into the `CuratorRunStats`
 * without re-counting via a second query.
 */
export interface ApplyDecayResult {
  readonly runId: CuratorRunId;
  readonly entriesScanned: number;
  readonly entriesDecayed: number;
}

/**
 * Driving (input) port: apply geometric decay to every active memory
 * entry of the workspace.
 *
 * Mirrors the "apply decay" step (#2) of the curator pass documented
 * in `docs/05-memoria-decay.md` §6 ("Pasada completa"). The use case:
 *
 * 1. Iterates over each `MemoryEntryKind` (`decision`, `learning`,
 *    `entity`, `task`, `turn`).
 * 2. For each entry, computes the new `Confidence` via the pure
 *    `DecayCalculator` domain service (which selects the per-kind /
 *    per-severity factor from `DecayFactor.forKind(...)`).
 * 3. Persists the change via `MemoryEntryWriter.applyDecay(...)`.
 * 4. Records the decay activity on the active `CuratorRun` aggregate
 *    (the orchestrator drives the aggregate; this use case only
 *    returns the counters).
 *
 * Idempotency:
 * - The use case is idempotent within a single `CuratorRun` only when
 *   it is called once per pass: re-applying decay after an entry has
 *   already been touched in the same run window would compound the
 *   factor. The orchestrator MUST call this use case at most once per
 *   `runId`. Within a *new* run, the calculator naturally accounts
 *   for the elapsed time since `last_used_ms`, so the second pass
 *   produces a smaller delta than the first.
 *
 * Performance:
 * - The implementation MUST stream entries (cursor / `iterate`) to
 *   stay within the <30s budget for a 50 K-entry workspace
 *   documented in the task brief.
 */
export interface ApplyDecay {
  apply(input: {
    runId: CuratorRunId;
    workspaceId: WorkspaceId;
  }): Promise<ApplyDecayResult>;
}
