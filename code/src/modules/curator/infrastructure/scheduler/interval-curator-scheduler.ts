import type { Clock } from "../../../../shared/application/ports/clock.port.ts";
import type { Logger } from "../../../../shared/application/ports/logger.port.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { RunCurator } from "../../application/ports/in/run-curator.port.ts";
import { CuratorRunTrigger } from "../../domain/value-objects/curator-run-trigger.ts";

/**
 * Default interval, in milliseconds, between scheduled curator
 * passes. Mirrors `docs/05-memoria-decay.md` §6 ("Cuando corre →
 * Programado: timer cada 24h si el server lleva mucho idle").
 */
const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Default cooldown between back-to-back triggers from the same
 * scheduler instance. Even when a turn-count threshold AND a time
 * threshold both fire in the same second, the scheduler emits one
 * run, not two.
 */
const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000;

/**
 * Construction options for {@link IntervalCuratorScheduler}.
 *
 * - `runCurator`: the orchestrator port the scheduler invokes when
 *   the trigger fires.
 * - `workspaceId`: the workspace this scheduler instance is scoped
 *   to. The composition root creates one scheduler per active
 *   workspace.
 * - `clock`: time source for scheduling decisions (idle cooldown,
 *   stale-trigger detection).
 * - `logger`: receives lifecycle events (`scheduler-started`,
 *   `scheduler-tick`, `scheduler-stopped`).
 * - `intervalMs`: optional override of the 24h default. Useful in
 *   tests.
 * - `cooldownMs`: optional override of the 5-minute cooldown.
 */
export interface IntervalCuratorSchedulerOptions {
  readonly runCurator: RunCurator;
  readonly workspaceId: WorkspaceId;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly intervalMs?: number;
  readonly cooldownMs?: number;
}

/**
 * Lightweight scheduler that fires the curator's `RunCurator` use
 * case at a fixed interval.
 *
 * The scheduler is intentionally minimal: in production, MCP servers
 * are short-lived (one process per session); the long-running case
 * is the CLI watching a workspace via `mcp-memoria curator-watch`.
 * The scheduler exposes:
 *
 * - `start(...)`: schedules the next tick. Idempotent — calling
 *   `start` while the scheduler is already running is a no-op.
 * - `stop(...)`: cancels the pending tick. Idempotent.
 * - `triggerNow(...)`: manual trigger respecting the cooldown. Used
 *   by the CLI's `mcp-memoria curator-run --workspace .` shortcut.
 *
 * Rationale for keeping the scheduler in `infrastructure/`:
 * - The trigger condition (24h interval, cooldown) is an
 *   infrastructure detail; the domain does not care WHEN the
 *   curator runs, only THAT it runs. The driving port
 *   (`RunCurator`) is the one the domain depends on; the scheduler
 *   is a wire-up over Node's `setInterval`.
 *
 * Concurrency model:
 * - Only ONE pass per scheduler instance is in flight at a time.
 *   The next tick is scheduled by `setTimeout` after the previous
 *   tick's promise resolves (success or failure). A pass that
 *   exceeds the 24h interval therefore stretches the interval
 *   accordingly; the scheduler does NOT pile up overlapping runs.
 */
export class IntervalCuratorScheduler {
  private readonly runCurator: RunCurator;
  private readonly workspaceId: WorkspaceId;
  private readonly clock: Clock;
  private readonly logger: Logger;
  private readonly intervalMs: number;
  private readonly cooldownMs: number;
  private timer: ReturnType<typeof setTimeout> | null;
  private lastTriggerMs: number;
  private inflight: boolean;
  private stopped: boolean;

  public constructor(options: IntervalCuratorSchedulerOptions) {
    this.runCurator = options.runCurator;
    this.workspaceId = options.workspaceId;
    this.clock = options.clock;
    this.logger = options.logger;
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.timer = null;
    this.lastTriggerMs = 0;
    this.inflight = false;
    this.stopped = false;
  }

  public start(): void {
    if (this.stopped) return;
    if (this.timer !== null) return;
    this.scheduleNext(this.intervalMs);
    this.logger.debug(
      {
        workspaceId: this.workspaceId.toString(),
        intervalMs: this.intervalMs,
      },
      "curator-scheduler: started",
    );
  }

  public stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.logger.debug(
      {
        workspaceId: this.workspaceId.toString(),
      },
      "curator-scheduler: stopped",
    );
  }

  /**
   * Manually triggers the curator IF the cooldown has elapsed.
   * Returns the awaited result (or `null` if the cooldown blocked
   * the trigger).
   */
  public async triggerNow(): Promise<void> {
    if (this.stopped || this.inflight) return;
    const nowMs = this.clock.nowMs();
    if (nowMs - this.lastTriggerMs < this.cooldownMs) return;
    await this.runOnce();
  }

  private scheduleNext(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      void this.tick();
    }, delayMs);
  }

  private async tick(): Promise<void> {
    if (this.stopped) return;
    await this.runOnce();
    this.scheduleNext(this.intervalMs);
  }

  private async runOnce(): Promise<void> {
    if (this.inflight) return;
    this.inflight = true;
    this.lastTriggerMs = this.clock.nowMs();
    try {
      await this.runCurator.run({
        workspaceId: this.workspaceId,
        trigger: CuratorRunTrigger.scheduled(),
      });
    } catch (cause: unknown) {
      this.logger.error(
        {
          workspaceId: this.workspaceId.toString(),
          err: cause instanceof Error ? cause.message : String(cause),
        },
        "curator-scheduler: run failed; will retry on next tick",
      );
    } finally {
      this.inflight = false;
    }
  }
}
