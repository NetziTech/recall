import type { Clock } from "../../../../shared/application/ports/clock.port.ts";
import type { Logger } from "../../../../shared/application/ports/logger.port.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import { EmbedderUnavailableError } from "../../domain/errors/embedder-unavailable-error.ts";
import type { Embedder } from "../../domain/services/embedder.ts";
import type { QueryKindValue } from "../../domain/value-objects/query-kind.ts";
import type {
  EmbeddingQueueItem,
  EmbeddingQueueRepository,
} from "../ports/out/embedding-queue-repository.port.ts";
import type {
  MemoryProjection,
  MemoryProjectionRepository,
} from "../ports/out/memory-projection-repository.port.ts";

/**
 * Result of one batch invocation of {@link EmbedAndPersistUseCase}.
 *
 * - `processed` — items the worker successfully embedded and
 *   persisted. The queue rows have been acknowledged.
 * - `failed` — items the worker could not embed (per-item rejection).
 *   The queue rows have been bumped via `recordFailure(...)` so the
 *   next dequeue will re-evaluate after the backoff window.
 * - `permanentFailures` — items whose `attempts` already reached the
 *   permanent-failure threshold. The queue rows are NOT acknowledged;
 *   a separate sweep is expected to promote them to a dead-letter
 *   audit log, or `recall reset-queue` resets their counter.
 * - `embedderUnavailable` — when `true`, the use case detected a
 *   transport-level embedder failure
 *   ({@link EmbedderUnavailableError}: model not loaded, network down,
 *   cache corrupt). Processing of the batch was ABORTED at the failing
 *   item; the items in `skipped` were NOT touched (their `attempts`
 *   counter is unchanged). The worker MUST back off the WHOLE batch
 *   before the next drain — see B-MCP-7
 *   ([issue #24](https://github.com/NetziTech/recall/issues/24)).
 *   `unavailableRetryAfterMs` carries the adapter's hint about how
 *   long to wait before retrying (or `null` for "use your own
 *   schedule").
 * - `skipped` — items the use case dequeued but did NOT attempt to
 *   embed because an earlier item in the batch tripped the
 *   `embedderUnavailable` short-circuit. The queue rows are
 *   untouched (no `attempts` bump, no acknowledge).
 */
export interface EmbedAndPersistResult {
  readonly processed: readonly string[];
  readonly failed: readonly string[];
  readonly permanentFailures: readonly string[];
  readonly embedderUnavailable: boolean;
  readonly unavailableRetryAfterMs: number | null;
  readonly skipped: readonly string[];
}

/**
 * After this many failed attempts, the worker stops retrying the
 * item and reports it as a permanent failure. Mirrors the spec in
 * the agent brief ("retry con exponential backoff hasta 5 intentos").
 */
const MAX_ATTEMPTS = 5;

/**
 * Identifier for the embedder model name carried into
 * `embedding_metadata.model_name`. The retrieval embedder port does
 * not expose the model name, so the worker takes it as an injected
 * constant the composition root provides (it reads
 * `.recall/config.json:embedder.model`). Default kept here as a
 * safety net.
 */
const DEFAULT_EMBEDDER_MODEL_NAME = "fastembed/BGE-Small-EN-1.5";

/**
 * Use case: drain one batch of pending embeddings.
 *
 * Architecture: see `AsyncEmbeddingWorker` (infrastructure) for the
 * scheduler that calls this use case in a loop.
 *
 * Pipeline (per batch):
 * 1. Dequeue up to `batchSize` items via
 *    `EmbeddingQueueRepository.dequeueBatch(...)`.
 * 2. For each item:
 *    a. Promote the permanent-failure case (skip; let the audit
 *       sweep handle it).
 *    b. Hydrate the source text via
 *       `MemoryProjectionRepository.loadProjectionsByHits([(kind,id)])`.
 *    c. Compute the embedding via the retrieval `Embedder` port.
 *    d. Persist via
 *       `EmbeddingQueueRepository.persistEmbedding(...)`, then
 *       acknowledge the queue row.
 *    e. On failure, call `recordFailure(...)` so the row stays in
 *       the queue but is rate-limited.
 *
 * Performance:
 * - The embedder typically costs 50–200 ms per item on the
 *   fastembed default; batches of 32 amortise the cost via the
 *   adapter's `embedBatch(...)` path. The hydration step is one
 *   round trip per batch (the projection repo's `loadProjections
 *   ByHits` is batched).
 * - The use case is INTENTIONALLY blocking on the embedder call;
 *   the worker's outer loop is what gives the read path elbow room.
 *
 * Idempotency:
 * - On a crash between `persistEmbedding` and `acknowledge`, the
 *   queue row stays pending and the next dequeue re-runs the
 *   embedder. The persistence layer's `INSERT OR REPLACE` makes the
 *   re-write a no-op.
 */
export class EmbedAndPersistUseCase {
  public constructor(
    private readonly queue: EmbeddingQueueRepository,
    private readonly projections: MemoryProjectionRepository,
    private readonly embedder: Embedder,
    private readonly clock: Clock,
    private readonly logger: Logger,
    private readonly modelName: string = DEFAULT_EMBEDDER_MODEL_NAME,
  ) {}

  public async drainBatch(input: {
    workspaceId: WorkspaceId;
    batchSize: number;
    backoffWindowMs: number;
  }): Promise<EmbedAndPersistResult> {
    const items = await this.dequeueItems(input);
    if (items.length === 0) return EMPTY_RESULT;

    const projIndex = await this.hydrateProjections(input.workspaceId, items);
    const acc = newAccumulator();

    for (const item of items) {
      if (acc.embedderUnavailable) {
        // An earlier item in this batch tripped a transport-level
        // failure. Skip the rest of the batch WITHOUT bumping any
        // queue counters — the worker will back off and retry the
        // same items once the embedder recovers (B-MCP-7).
        acc.skipped.push(item.id);
        continue;
      }
      await this.processItem(item, projIndex, acc);
    }

    return Object.freeze({
      processed: Object.freeze([...acc.processed]),
      failed: Object.freeze([...acc.failed]),
      permanentFailures: Object.freeze([...acc.permanent]),
      embedderUnavailable: acc.embedderUnavailable,
      unavailableRetryAfterMs: acc.unavailableRetryAfterMs,
      skipped: Object.freeze([...acc.skipped]),
    });
  }

  // -- per-item pipeline (extracted from drainBatch to keep its
  //    cognitive complexity ≤ 15 per Sonar S3776) -----------------------

  private async dequeueItems(input: {
    workspaceId: WorkspaceId;
    batchSize: number;
    backoffWindowMs: number;
  }): Promise<readonly EmbeddingQueueItem[]> {
    const now = this.clock.now();
    const availableAfter = now.subtract(input.backoffWindowMs);
    return this.queue.dequeueBatch({
      workspaceId: input.workspaceId,
      limit: input.batchSize,
      availableAfter,
    });
  }

  private async hydrateProjections(
    workspaceId: WorkspaceId,
    items: readonly EmbeddingQueueItem[],
  ): Promise<Map<string, MemoryProjection>> {
    const hits = items.map((it) => ({
      kind: it.targetKind,
      id: it.targetRowId,
    }));
    const projections = await this.projections.loadProjectionsByHits({
      workspaceId,
      hits,
    });
    const out = new Map<string, MemoryProjection>();
    for (const p of projections) {
      out.set(this.indexKey(p.kind, p.id), p);
    }
    return out;
  }

  private async processItem(
    item: EmbeddingQueueItem,
    projIndex: Map<string, MemoryProjection>,
    acc: DrainAccumulator,
  ): Promise<void> {
    if (item.attempts >= MAX_ATTEMPTS) {
      this.markPermanentFailure(item, acc);
      return;
    }
    const projection = projIndex.get(
      this.indexKey(item.targetKind, item.targetRowId),
    );
    if (projection === undefined) {
      await this.ackPrunedItem(item, acc);
      return;
    }
    await this.embedAndStore(item, projection, acc);
  }

  private markPermanentFailure(
    item: EmbeddingQueueItem,
    acc: DrainAccumulator,
  ): void {
    acc.permanent.push(item.id);
    this.logger.error(
      {
        queueId: item.id,
        workspaceId: item.workspaceId.toString(),
        attempts: item.attempts,
      },
      "embedding queue item reached permanent failure",
    );
  }

  private async ackPrunedItem(
    item: EmbeddingQueueItem,
    acc: DrainAccumulator,
  ): Promise<void> {
    // The underlying row was pruned between enqueue and dequeue.
    // Acknowledge the queue row so we do not retry forever.
    await this.queue.acknowledge(item.id);
    acc.processed.push(item.id);
    this.logger.debug(
      {
        queueId: item.id,
        targetKind: item.targetKind,
        targetRowId: item.targetRowId,
      },
      "embedding queue item ack'd: target row no longer exists",
    );
  }

  private async embedAndStore(
    item: EmbeddingQueueItem,
    projection: MemoryProjection,
    acc: DrainAccumulator,
  ): Promise<void> {
    const embeddedText = this.searchableTextFor(projection);
    try {
      const vector = await this.embedder.embed(embeddedText);
      await this.queue.persistEmbedding({
        workspaceId: item.workspaceId,
        targetKind: item.targetKind,
        targetRowId: item.targetRowId,
        embeddedText,
        modelName: this.modelName,
        vector,
        persistedAt: this.clock.now(),
      });
      await this.queue.acknowledge(item.id);
      acc.processed.push(item.id);
    } catch (cause: unknown) {
      await this.recordEmbedFailure(item, cause, acc);
    }
  }

  private async recordEmbedFailure(
    item: EmbeddingQueueItem,
    cause: unknown,
    acc: DrainAccumulator,
  ): Promise<void> {
    if (cause instanceof EmbedderUnavailableError) {
      this.markBatchUnavailable(item, cause, acc);
      return;
    }
    const message = cause instanceof Error ? cause.message : String(cause);
    await this.queue.recordFailure({
      queueId: item.id,
      errorMessage: message,
    });
    acc.failed.push(item.id);
    this.logger.warn(
      {
        queueId: item.id,
        attempts: item.attempts + 1,
        err: message,
      },
      "embedding attempt failed; queued for retry",
    );
  }

  private markBatchUnavailable(
    item: EmbeddingQueueItem,
    cause: EmbedderUnavailableError,
    acc: DrainAccumulator,
  ): void {
    // Transport-level failure: the embedder is currently down for
    // EVERY input. Mark the batch for back-off and skip the
    // remaining items WITHOUT bumping their attempts — burning the
    // per-item retry budget while the model is still loading is
    // exactly the bug B-MCP-7 fixes.
    acc.embedderUnavailable = true;
    acc.unavailableRetryAfterMs = cause.retryAfterMs;
    acc.skipped.push(item.id);
    this.logger.warn(
      {
        queueId: item.id,
        workspaceId: item.workspaceId.toString(),
        retryAfterMs: cause.retryAfterMs,
        err: cause.message,
      },
      "embedder unavailable; aborting batch without bumping attempts",
    );
  }

  // -- helpers ----------------------------------------------------------

  private indexKey(kind: QueryKindValue, id: string): string {
    return `${kind}::${id}`;
  }

  private searchableTextFor(projection: MemoryProjection): string {
    // Per `docs/03-modelo-datos.md` §5 — the searchable text per kind:
    //   decision: title + "\n" + rationale (preview is rationale here)
    //   learning: content + "\n" + (trigger ?? "")
    //   entity:   name + " " + entity_kind + "\n" + description
    //   turn:     summary + "\n" + (intent ?? "") + "\n" + (outcome ?? "")
    //
    // The projection only carries `title` + `preview`; the application
    // boundary (the memory module's persistence adapter) is
    // responsible for filling those slots with the right
    // concatenation. Here we simply join the two on a newline — the
    // adapter has already encoded the per-kind rule into `preview`.
    return `${projection.title}\n${projection.preview}`;
  }
}

/**
 * Mutable bag the per-item helpers in {@link EmbedAndPersistUseCase}
 * write into. Local to this module — kept separate from
 * {@link EmbedAndPersistResult} (immutable, read-only by callers) so
 * the helpers stay simple `void`-returning routines.
 */
interface DrainAccumulator {
  readonly processed: string[];
  readonly failed: string[];
  readonly permanent: string[];
  readonly skipped: string[];
  embedderUnavailable: boolean;
  unavailableRetryAfterMs: number | null;
}

function newAccumulator(): DrainAccumulator {
  return {
    processed: [],
    failed: [],
    permanent: [],
    skipped: [],
    embedderUnavailable: false,
    unavailableRetryAfterMs: null,
  };
}

/**
 * Pre-frozen empty result returned when the dequeue brings back zero
 * items. Hoisted to module scope so `drainBatch` does not allocate it
 * on every empty-poll iteration.
 */
const EMPTY_RESULT: EmbedAndPersistResult = Object.freeze({
  processed: Object.freeze([]),
  failed: Object.freeze([]),
  permanentFailures: Object.freeze([]),
  embedderUnavailable: false,
  unavailableRetryAfterMs: null,
  skipped: Object.freeze([]),
});

/**
 * Re-export of the queue-item type so consumers that orchestrate
 * the worker (e.g. the `AsyncEmbeddingWorker` in
 * `infrastructure/worker/`) pick it up alongside the use-case class.
 */
export type { EmbeddingQueueItem };
