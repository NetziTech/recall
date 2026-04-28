import type { Clock } from "../../../../shared/application/ports/clock.port.ts";
import type { IdGenerator } from "../../../../shared/application/ports/id-generator.port.ts";
import type { Logger } from "../../../../shared/application/ports/logger.port.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import { CuratorRun } from "../../domain/aggregates/curator-run.ts";
import type { CuratorRunRepository } from "../../domain/repositories/curator-run-repository.ts";
import { CuratorRunId } from "../../domain/value-objects/curator-run-id.ts";
import { CuratorRunStats } from "../../domain/value-objects/curator-run-stats.ts";
import type { CuratorRunTrigger } from "../../domain/value-objects/curator-run-trigger.ts";
import { CuratorApplicationError } from "../errors/curator-application-error.ts";
import type { ApplyDecay } from "../ports/in/apply-decay.port.ts";
import type { ConsolidateSimilar } from "../ports/in/consolidate-similar.port.ts";
import type { PruneLowConfidence } from "../ports/in/prune-low-confidence.port.ts";
import type { RollupSession } from "../ports/in/rollup-session.port.ts";
import type {
  RunCurator,
  RunCuratorResult,
} from "../ports/in/run-curator.port.ts";
import type { SelfHeal } from "../ports/in/self-heal.port.ts";

/**
 * Threshold above which an in-flight curator row is considered stale
 * and will be force-completed by the orchestrator. Mirrors the spec
 * sentence in `docs/05-memoria-decay.md` §6:
 *
 * > Si excede [el budget de 5s para 10K entries], dividir en partes y
 * > correr incrementalmente.
 *
 * 5 minutes is generous: the documented per-pass budget is <30s for
 * 50K entries; anything close to 5 minutes indicates a crashed pass.
 */
const STALE_RUN_THRESHOLD_MS = 5 * 60 * 1000;

/**
 * Orchestrator: executes one full curator pass end-to-end.
 *
 * Implements the `RunCurator` driving port. Mirrors the orchestration
 * documented in `docs/05-memoria-decay.md` §6 ("Pasada completa").
 *
 * Responsibilities:
 * 1. Refuse a new run if a previous run is still in flight (and is
 *    not stale). The check is via
 *    `CuratorRunRepository.findLastByWorkspace(...)`: if the row's
 *    `endedAt` is `null` AND its `startedAt` is younger than
 *    `STALE_RUN_THRESHOLD_MS`, raise
 *    `CuratorApplicationError.runAlreadyInflight(...)`.
 * 2. Recover stale in-flight runs by force-completing them with a
 *    synthetic `CuratorRunStats.empty()` and a `warn`-level log. The
 *    log line carries `staleRunId` and `ageMs` so the recovery path
 *    is observable in tests via the logger spy without needing a
 *    dedicated error type.
 * 3. Mint a fresh `CuratorRunId`, build a `CuratorRun` aggregate via
 *    `CuratorRun.start(...)`, persist it (so the in-flight detection
 *    above works on subsequent attempts).
 * 4. Run the sub-use-cases in order:
 *      a. `RollupSession` (only when trigger is `session_close`).
 *      b. `ApplyDecay`.
 *      c. `ConsolidateSimilar`.
 *      d. `SelfHeal`.
 *      e. `PruneLowConfidence`.
 *    Each step's counters are folded into the running `CuratorRunStats`.
 * 5. Call `CuratorRun.complete(...)` with the final stats and
 *    persist again. The aggregate's events are drained by the
 *    application layer (composition root subscribes to logger).
 * 6. Return the `RunCuratorResult` with the final stats and the
 *    findings counter.
 *
 * Concurrency model:
 * - The orchestration does NOT wrap the whole pass in a single SQL
 *   transaction (the budget is multi-second; holding a write lock
 *   that long would starve every other writer). Each sub-use-case
 *   owns its own transaction boundary; partial failures roll back
 *   the offending step and bubble the exception up. Composite
 *   atomicity is provided by the audit row (`pruned`) so the user
 *   never sees a half-deleted entry.
 *
 * Error handling: every sub-use-case throws on infrastructure
 * errors. The orchestrator does NOT swallow them — the run is left
 * in flight (the next pass either picks it up via stale-recovery or
 * raises `runAlreadyInflight`).
 */
export class RunCuratorUseCase implements RunCurator {
  public constructor(
    private readonly curatorRuns: CuratorRunRepository,
    private readonly rollupSession: RollupSession,
    private readonly applyDecay: ApplyDecay,
    private readonly consolidateSimilar: ConsolidateSimilar,
    private readonly selfHeal: SelfHeal,
    private readonly pruneLowConfidence: PruneLowConfidence,
    private readonly idGenerator: IdGenerator,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  public async run(input: {
    workspaceId: WorkspaceId;
    trigger: CuratorRunTrigger;
  }): Promise<RunCuratorResult> {
    await this.guardInFlightRun(input.workspaceId);

    const startedAt = this.clock.now();
    const runId = CuratorRunId.from(this.idGenerator.generateString());
    const run = CuratorRun.start({
      id: runId,
      workspaceId: input.workspaceId,
      trigger: input.trigger,
      occurredAt: startedAt,
    });
    await this.curatorRuns.save(run);

    let stats = CuratorRunStats.empty();
    let findingsRecorded = 0;

    try {
      if (input.trigger.isSessionClose()) {
        const rollupResult = await this.rollupSession.rollup({
          workspaceId: input.workspaceId,
        });
        this.logger.debug(
          {
            runId: runId.toString(),
            sessionsClosed: rollupResult.sessionsClosed,
          },
          "curator: session rollup completed",
        );
      }

      const decayResult = await this.applyDecay.apply({
        runId,
        workspaceId: input.workspaceId,
      });
      stats = stats.with({
        entriesScanned: stats.getEntriesScanned() + decayResult.entriesScanned,
        entriesDecayed: stats.getEntriesDecayed() + decayResult.entriesDecayed,
      });

      const consolidateResult = await this.consolidateSimilar.consolidate({
        runId,
        workspaceId: input.workspaceId,
      });
      stats = stats.with({
        learningsConsolidated:
          stats.getLearningsConsolidated() +
          consolidateResult.learningsFolded,
      });

      const healResult = await this.selfHeal.heal({
        runId,
        workspaceId: input.workspaceId,
      });
      stats = stats.with({
        pathsCorrected: stats.getPathsCorrected() + healResult.pathsCorrected,
        embeddingsRequeued:
          stats.getEmbeddingsRequeued() + healResult.embeddingsRequeued,
        openQuestionsAged:
          stats.getOpenQuestionsAged() + healResult.openQuestionsAged,
      });
      findingsRecorded += healResult.findingsRecorded;

      const pruneResult = await this.pruneLowConfidence.prune({
        runId,
        workspaceId: input.workspaceId,
      });
      stats = stats.with({
        entriesPruned: stats.getEntriesPruned() + pruneResult.entriesPruned,
      });
    } catch (cause: unknown) {
      this.logger.error(
        {
          runId: runId.toString(),
          workspaceId: input.workspaceId.toString(),
          err: cause instanceof Error ? cause.message : String(cause),
        },
        "curator: full pass failed; leaving the run in-flight for recovery",
      );
      throw cause;
    }

    const completedAt = this.clock.now();
    const durationMs = completedAt.diff(startedAt);
    const finalStats = stats.with({
      durationMs: durationMs >= 0 ? durationMs : 0,
    });

    const completed = await this.curatorRuns.findById(runId);
    if (completed === null) {
      throw CuratorApplicationError.runNotFound(runId.toString());
    }
    completed.complete({ finalStats, occurredAt: completedAt });
    await this.curatorRuns.save(completed);

    this.logger.info(
      {
        runId: runId.toString(),
        workspaceId: input.workspaceId.toString(),
        trigger: input.trigger.toString(),
        durationMs: finalStats.getDurationMs(),
        entriesScanned: finalStats.getEntriesScanned(),
        entriesDecayed: finalStats.getEntriesDecayed(),
        entriesPruned: finalStats.getEntriesPruned(),
        learningsConsolidated: finalStats.getLearningsConsolidated(),
        findingsRecorded,
      },
      "curator: full pass completed",
    );

    return {
      runId,
      stats: finalStats,
      findingsRecorded,
    };
  }

  /**
   * If a previous run for the same workspace is still in flight,
   * either recover it (when stale) or refuse the new run.
   */
  private async guardInFlightRun(workspaceId: WorkspaceId): Promise<void> {
    const last = await this.curatorRuns.findLastByWorkspace(workspaceId);
    if (last === null) return;
    if (last.isCompleted()) return;

    const ageMs = this.clock.nowMs() - last.getStartedAt().toEpochMs();
    if (ageMs < STALE_RUN_THRESHOLD_MS) {
      throw CuratorApplicationError.runAlreadyInflight(
        workspaceId.toString(),
        last.getId().toString(),
      );
    }

    // Stale: force-complete with synthetic stats so the table is clean
    // before we mint a new run.
    const recoveryAt = this.clock.now();
    last.complete({
      finalStats: CuratorRunStats.empty(),
      occurredAt: recoveryAt,
    });
    await this.curatorRuns.save(last);
    this.logger.warn(
      {
        workspaceId: workspaceId.toString(),
        staleRunId: last.getId().toString(),
        ageMs,
      },
      "curator: recovered a stale in-flight run before starting a new pass",
    );
  }
}
