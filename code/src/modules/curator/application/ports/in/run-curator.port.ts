import type { WorkspaceId } from "../../../../../shared/domain/value-objects/workspace-id.ts";
import type { CuratorRunId } from "../../../domain/value-objects/curator-run-id.ts";
import type { CuratorRunStats } from "../../../domain/value-objects/curator-run-stats.ts";
import type { CuratorRunTrigger } from "../../../domain/value-objects/curator-run-trigger.ts";

/**
 * Outcome of one `RunCurator` invocation. Carries the `runId` so the
 * caller can join with `curator_runs` for the audit trail and the
 * final `CuratorRunStats` for inline reporting.
 */
export interface RunCuratorResult {
  readonly runId: CuratorRunId;
  readonly stats: CuratorRunStats;
  readonly findingsRecorded: number;
}

/**
 * Driving (input) port: execute one full curator pass end-to-end.
 *
 * Orchestrates the steps documented in `docs/05-memoria-decay.md` §6
 * ("Pasada completa") in this exact order:
 *
 * 1. (When trigger === `session_close`) `RollupSession`.
 * 2. `ApplyDecay` — walks every kind, decays.
 * 3. `ConsolidateSimilar` — folds learnings.
 * 4. `SelfHeal` — paths, conflicts, embedding drift, open questions.
 * 5. `PruneLowConfidence` — drops low-confidence rows.
 * 6. `CuratorRun.complete(...)` — finalises the aggregate, persists,
 *    drains events.
 *
 * Each step's counters are folded into the running `CuratorRunStats`.
 * The orchestration runs *outside* a single SQL transaction (the
 * pass can take several seconds and would block writers); each
 * sub-use-case owns its own transaction boundary.
 *
 * Idempotency:
 * - The orchestrator is "run-once-per-pass": calling `RunCurator`
 *   while a previous pass is still in flight raises
 *   `CuratorRunAlreadyInflightError` (not the domain
 *   `CuratorRunAlreadyCompletedError`, which targets a different
 *   programming bug). The detection uses the partial index
 *   `idx_curator_runs_inflight` defined in migration
 *   `003__pruned-and-curator-runs.sql`.
 * - Recovery from a crashed pass: the orchestrator inspects
 *   `findCurrentInFlight(workspaceId)`; if the in-flight row is
 *   older than `STALE_RUN_THRESHOLD_MS`, it marks the run complete
 *   with a synthetic `CuratorRunStats` and a warning log, then
 *   starts a fresh run.
 *
 * Performance budget: <30s for a 50K-entry workspace.
 */
export interface RunCurator {
  run(input: {
    workspaceId: WorkspaceId;
    trigger: CuratorRunTrigger;
  }): Promise<RunCuratorResult>;
}
