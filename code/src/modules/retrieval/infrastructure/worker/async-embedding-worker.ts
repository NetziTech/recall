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
   * Logger for worker lifecycle events. The worker emits one
   * `info`-level entry on `start()` and `stop()`, one `debug`-level
   * entry per drain iteration, and `warn` on transient failures.
   */
  readonly logger: Logger;
}

const DEFAULT_BATCH_SIZE = 32;
const DEFAULT_BACKOFF_WINDOW_MS = 30_000;
const DEFAULT_IDLE_POLL_MS = 200;

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
  private readonly logger: Logger;
  private running: boolean;
  private timer: ReturnType<typeof setTimeout> | null;
  private inFlight: Promise<void> | null;

  public constructor(
    private readonly useCase: EmbedAndPersistUseCase,
    options: AsyncEmbeddingWorkerOptions,
  ) {
    this.workspaceId = options.workspaceId;
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    this.backoffWindowMs =
      options.backoffWindowMs ?? DEFAULT_BACKOFF_WINDOW_MS;
    this.idlePollMs = options.idlePollMs ?? DEFAULT_IDLE_POLL_MS;
    this.logger = options.logger;
    this.running = false;
    this.timer = null;
    this.inFlight = null;
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
    try {
      const result = await this.useCase.drainBatch({
        workspaceId: this.workspaceId,
        batchSize: this.batchSize,
        backoffWindowMs: this.backoffWindowMs,
      });
      processedCount = result.processed.length;
      if (processedCount > 0 || result.failed.length > 0) {
        this.logger.debug(
          {
            workspaceId: this.workspaceId.toString(),
            processed: processedCount,
            failed: result.failed.length,
            permanentFailures: result.permanentFailures.length,
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

    // Hot loop when there was work; sleep when idle.
    const nextDelay = processedCount > 0 ? 0 : this.idlePollMs;
    this.scheduleNextDrain(nextDelay);
  }
}
