import type { Logger } from "../../../../shared/application/ports/logger.port.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { EmbedAndPersistUseCase } from "../../application/use-cases/embed-and-persist.use-case.ts";

/**
 * Construction options for {@link AsyncEmbeddingWorker}.
 */
export interface AsyncEmbeddingWorkerOptions {
  /**
   * Workspace whose queue this worker drains.
   */
  readonly workspaceId: WorkspaceId;

  /**
   * Maximum batch size per drain iteration. Defaults to 32 — the
   * `fastembed` adapter's `embedBatch(...)` amortises the per-call
   * overhead at this granularity.
   */
  readonly batchSize?: number;

  /**
   * Backoff window in milliseconds. Items whose latest enqueue
   * timestamp is newer than `now - backoffWindowMs` are skipped on
   * subsequent dequeues, giving transient failures time to clear.
   * Defaults to 30 s.
   */
  readonly backoffWindowMs?: number;

  /**
   * Idle poll interval in milliseconds. When the previous batch was
   * empty, the worker waits this long before checking again.
   * Defaults to 200 ms.
   */
  readonly idlePollMs?: number;

  /**
   * Initial back-off delay after the use case reports
   * `embedderUnavailable: true` (transport-level failure: model not
   * loaded, network down, cache corrupt). The worker doubles this on
   * each consecutive unavailable batch up to {@link maxUnavailableBackoffMs}.
   * Defaults to 1 000 ms — enough that fastembed's ~4 s cold-start
   * completes before the next 4-attempt back-off window
   * (1 s → 2 s → 4 s → 8 s = 15 s total).
   *
   * The worker prefers the use case's per-call hint
   * (`unavailableRetryAfterMs`) when present and resets the back-off
   * sequence on the first batch that completes without an unavailable
   * signal — see B-MCP-7
   * ([issue #24](https://github.com/NetziTech/recall/issues/24)).
   */
  readonly unavailableBackoffInitialMs?: number;

  /**
   * Upper bound on the exponential back-off applied on consecutive
   * `embedderUnavailable` batches. Defaults to 60 000 ms — the worker
   * should still poll once per minute even on a long outage so it
   * notices when the embedder recovers.
   */
  readonly maxUnavailableBackoffMs?: number;

  /**
   * Logger for worker lifecycle events. The worker emits one
   * `info`-level entry on `start()` and `stop()`, one `debug`-level
   * entry per drain iteration, and `warn` on transient failures.
   */
  readonly logger: Logger;
}

const DEFAULT_BATCH_SIZE = 32;
const DEFAULT_BACKOFF_WINDOW_MS = 30_000;
const DEFAULT_IDLE_POLL_MS = 200;
const DEFAULT_UNAVAILABLE_BACKOFF_INITIAL_MS = 1_000;
const DEFAULT_MAX_UNAVAILABLE_BACKOFF_MS = 60_000;

/**
 * Background worker that drains the asynchronous embedding queue.
 *
 * Architecture:
 * - The worker is a thin scheduler around the
 *   `EmbedAndPersistUseCase`. The use case owns the per-batch
 *   logic (hydration, embedding, persistence, ack, failure
 *   recording). The worker owns the loop (start/stop, polling
 *   interval, graceful shutdown).
 *
 * Lifecycle:
 * - `start()` schedules the first drain on the next microtask, then
 *   keeps re-scheduling until `stop()` is called.
 * - `stop()` flips a flag and awaits the in-flight drain to settle.
 *   Idempotent.
 *
 * Backpressure:
 * - When a drain returns more than zero processed items, the next
 *   drain runs immediately (the queue is hot). When a drain returns
 *   zero, the worker sleeps `idlePollMs` before retrying. This keeps
 *   the CPU near zero when the queue is empty without sacrificing
 *   throughput when it is not.
 *
 * Why not `setInterval`:
 * - `setInterval` would let drains overlap if the embedder is slower
 *   than the interval. The recursive `setTimeout` chain used here
 *   guarantees one drain at a time.
 *
 * Threading:
 * - The worker runs on the same event loop as the rest of the
 *   server. Embedder calls release the loop while waiting on the
 *   ONNX runtime (fastembed's WASM is async-friendly), so the read
 *   path stays responsive.
 */
export class AsyncEmbeddingWorker {
  private readonly workspaceId: WorkspaceId;
  private readonly batchSize: number;
  private readonly backoffWindowMs: number;
  private readonly idlePollMs: number;
  private readonly unavailableBackoffInitialMs: number;
  private readonly maxUnavailableBackoffMs: number;
  private readonly logger: Logger;
  private running: boolean;
  private timer: ReturnType<typeof setTimeout> | null;
  private inFlight: Promise<void> | null;
  private consecutiveUnavailableBatches: number;

  public constructor(
    private readonly useCase: EmbedAndPersistUseCase,
    options: AsyncEmbeddingWorkerOptions,
  ) {
    this.workspaceId = options.workspaceId;
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    this.backoffWindowMs =
      options.backoffWindowMs ?? DEFAULT_BACKOFF_WINDOW_MS;
    this.idlePollMs = options.idlePollMs ?? DEFAULT_IDLE_POLL_MS;
    this.unavailableBackoffInitialMs =
      options.unavailableBackoffInitialMs ??
      DEFAULT_UNAVAILABLE_BACKOFF_INITIAL_MS;
    this.maxUnavailableBackoffMs =
      options.maxUnavailableBackoffMs ?? DEFAULT_MAX_UNAVAILABLE_BACKOFF_MS;
    this.logger = options.logger;
    this.running = false;
    this.timer = null;
    this.inFlight = null;
    this.consecutiveUnavailableBatches = 0;
  }

  /**
   * Starts the polling loop. Returns immediately; the first drain
   * is scheduled on the next tick. Calling `start()` while already
   * running is a no-op.
   */
  public start(): void {
    if (this.running) return;
    this.running = true;
    this.logger.info(
      { workspaceId: this.workspaceId.toString() },
      "embedding worker started",
    );
    this.scheduleNextDrain(0);
  }

  /**
   * Stops the polling loop and awaits the in-flight drain to settle.
   * Idempotent: calling `stop()` while already stopped resolves
   * immediately.
   */
  public async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.inFlight !== null) {
      await this.inFlight;
    }
    this.logger.info(
      { workspaceId: this.workspaceId.toString() },
      "embedding worker stopped",
    );
  }

  // -- internals --------------------------------------------------------

  private scheduleNextDrain(delayMs: number): void {
    if (!this.running) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.inFlight = this.runDrain().finally(() => {
        this.inFlight = null;
      });
      // The recursive scheduling lives inside `runDrain` itself; we
      // do not re-enter from here.
      void this.inFlight;
    }, delayMs);
  }

  private async runDrain(): Promise<void> {
    let processedCount = 0;
    let unavailable = false;
    let unavailableHintMs: number | null = null;
    try {
      const result = await this.useCase.drainBatch({
        workspaceId: this.workspaceId,
        batchSize: this.batchSize,
        backoffWindowMs: this.backoffWindowMs,
      });
      processedCount = result.processed.length;
      unavailable = result.embedderUnavailable;
      unavailableHintMs = result.unavailableRetryAfterMs;
      if (
        processedCount > 0 ||
        result.failed.length > 0 ||
        unavailable
      ) {
        this.logger.debug(
          {
            workspaceId: this.workspaceId.toString(),
            processed: processedCount,
            failed: result.failed.length,
            permanentFailures: result.permanentFailures.length,
            embedderUnavailable: unavailable,
            skipped: result.skipped.length,
          },
          "embedding worker drain completed",
        );
      }
    } catch (cause: unknown) {
      // The use case is supposed to swallow per-item failures via
      // `recordFailure(...)`. A throw here means the queue read
      // itself failed (DB lock, schema mismatch, ...). We log and
      // back off — the next iteration will retry. We do NOT crash
      // the server.
      this.logger.error(
        {
          workspaceId: this.workspaceId.toString(),
          err: cause instanceof Error ? cause.message : String(cause),
        },
        "embedding worker drain failed",
      );
    }

    if (!this.running) return;

    if (unavailable) {
      this.consecutiveUnavailableBatches += 1;
      const nextDelay = this.computeUnavailableBackoffMs(unavailableHintMs);
      this.logger.warn(
        {
          workspaceId: this.workspaceId.toString(),
          consecutiveUnavailableBatches: this.consecutiveUnavailableBatches,
          nextDelayMs: nextDelay,
          retryAfterHintMs: unavailableHintMs,
        },
        "embedder unavailable; backing off entire batch",
      );
      this.scheduleNextDrain(nextDelay);
      return;
    }

    // Recovered (or never tripped this iteration): reset the streak so
    // a future outage starts back-off from the initial delay again.
    this.consecutiveUnavailableBatches = 0;
    // Hot loop when there was work; sleep when idle.
    const nextDelay = processedCount > 0 ? 0 : this.idlePollMs;
    this.scheduleNextDrain(nextDelay);
  }

  /**
   * Computes the next back-off delay after a transport-level
   * `embedderUnavailable` batch. Honours the use case's per-call hint
   * when present; otherwise applies an exponential schedule
   * (`initial * 2 ^ (n-1)`) capped at `maxUnavailableBackoffMs`.
   */
  private computeUnavailableBackoffMs(
    hintMs: number | null,
  ): number {
    if (hintMs !== null && hintMs > 0) {
      return Math.min(hintMs, this.maxUnavailableBackoffMs);
    }
    const exponent = Math.max(0, this.consecutiveUnavailableBatches - 1);
    // 2 ** 30 ≈ 1.07 billion ms (~12 days) — cap before computing to
    // keep the multiplication in safe integer territory even on a
    // pathological outage that lasts hundreds of consecutive batches.
    const safeExponent = Math.min(exponent, 30);
    const exponential =
      this.unavailableBackoffInitialMs * 2 ** safeExponent;
    return Math.min(exponential, this.maxUnavailableBackoffMs);
  }
}
