import { beforeEach, describe, expect, it } from "vitest";

import { EmbedAndPersistUseCase } from "../../../../src/modules/retrieval/application/use-cases/embed-and-persist.use-case.ts";
import type {
  EmbeddingQueueItem,
  EmbeddingQueueRepository,
} from "../../../../src/modules/retrieval/application/ports/out/embedding-queue-repository.port.ts";
import type {
  MemoryProjection,
  MemoryProjectionRepository,
} from "../../../../src/modules/retrieval/application/ports/out/memory-projection-repository.port.ts";
import type { Embedder } from "../../../../src/modules/retrieval/domain/services/embedder.ts";
import { EmbeddingVector } from "../../../../src/modules/retrieval/domain/value-objects/embedding-vector.ts";
import type { QueryKindValue } from "../../../../src/modules/retrieval/domain/value-objects/query-kind.ts";
import type { DecisionRef } from "../../../../src/modules/retrieval/domain/value-objects/decision-ref.ts";
import type { EntityRef } from "../../../../src/modules/retrieval/domain/value-objects/entity-ref.ts";
import type { OpenQuestionRef } from "../../../../src/modules/retrieval/domain/value-objects/open-question-ref.ts";
import type { TaskRef } from "../../../../src/modules/retrieval/domain/value-objects/task-ref.ts";
import type { TurnRef } from "../../../../src/modules/retrieval/domain/value-objects/turn-ref.ts";
import type { WorkspaceAnchorPayload } from "../../../../src/modules/retrieval/domain/value-objects/workspace-anchor-payload.ts";
import { LastUsed } from "../../../../src/modules/memory/domain/value-objects/last-used.ts";
import { UseCount } from "../../../../src/modules/memory/domain/value-objects/use-count.ts";
import { Confidence } from "../../../../src/shared/domain/value-objects/confidence.ts";
import { Tags } from "../../../../src/shared/domain/value-objects/tags.ts";
import { Timestamp } from "../../../../src/shared/domain/value-objects/timestamp.ts";
import { WorkspaceId } from "../../../../src/shared/domain/value-objects/workspace-id.ts";
import { FakeClock } from "../../../../src/shared/infrastructure/clock/fake-clock.ts";
import { ANCHOR_TIME_MS, makeWorkspaceId } from "../../../helpers/factories.ts";
import { SilentLogger } from "../../../helpers/test-doubles.ts";

// ─── Test doubles ──────────────────────────────────────────────────────

interface QueueOpRecord {
  readonly type:
    | "enqueue"
    | "dequeue"
    | "ack"
    | "fail"
    | "persist"
    | "count";
  readonly payload?: unknown;
}

class StubQueue implements EmbeddingQueueRepository {
  public items: EmbeddingQueueItem[] = [];
  public ops: QueueOpRecord[] = [];
  public dequeueError: Error | null = null;

  public enqueue(): Promise<void> {
    this.ops.push({ type: "enqueue" });
    return Promise.resolve();
  }
  public dequeueBatch(input: {
    workspaceId: WorkspaceId;
    limit: number;
    availableAfter: Timestamp;
  }): Promise<readonly EmbeddingQueueItem[]> {
    if (this.dequeueError !== null) return Promise.reject(this.dequeueError);
    const out = this.items.slice(0, input.limit);
    this.ops.push({ type: "dequeue", payload: out.length });
    return Promise.resolve(out);
  }
  public acknowledge(queueId: string): Promise<void> {
    this.items = this.items.filter((i) => i.id !== queueId);
    this.ops.push({ type: "ack", payload: queueId });
    return Promise.resolve();
  }
  public recordFailure(input: {
    queueId: string;
    errorMessage: string;
  }): Promise<void> {
    this.items = this.items.map((i) =>
      i.id === input.queueId
        ? { ...i, attempts: i.attempts + 1, lastError: input.errorMessage }
        : i,
    );
    this.ops.push({ type: "fail", payload: input.queueId });
    return Promise.resolve();
  }
  public persistEmbedding(input: {
    workspaceId: WorkspaceId;
    targetKind: QueryKindValue;
    targetRowId: string;
    embeddedText: string;
    modelName: string;
    vector: EmbeddingVector;
    persistedAt: Timestamp;
  }): Promise<void> {
    this.ops.push({ type: "persist", payload: input });
    return Promise.resolve();
  }
  public countPending(): Promise<number> {
    this.ops.push({ type: "count" });
    return Promise.resolve(this.items.length);
  }
}

class StubProjections implements MemoryProjectionRepository {
  public projections: readonly MemoryProjection[] = [];
  public loadWorkspaceAnchor(): Promise<WorkspaceAnchorPayload | null> {
    return Promise.resolve(null);
  }
  public listActiveDecisions(): Promise<readonly DecisionRef[]> {
    return Promise.resolve([]);
  }
  public listOpenTasks(): Promise<readonly TaskRef[]> {
    return Promise.resolve([]);
  }
  public listRecentTurns(): Promise<readonly TurnRef[]> {
    return Promise.resolve([]);
  }
  public listOpenQuestions(): Promise<readonly OpenQuestionRef[]> {
    return Promise.resolve([]);
  }
  public loadProjectionsByHits(input: {
    hits: readonly { readonly kind: QueryKindValue; readonly id: string }[];
  }): Promise<readonly MemoryProjection[]> {
    const want = new Set(input.hits.map((h) => `${h.kind}::${h.id}`));
    return Promise.resolve(
      this.projections.filter((p) => want.has(`${p.kind}::${p.id}`)),
    );
  }
  public loadEntityRefsByIds(): Promise<readonly EntityRef[]> {
    return Promise.resolve([]);
  }
  public bumpUsage(): Promise<void> {
    return Promise.resolve();
  }
}

class StubEmbedder implements Embedder {
  public callCount = 0;
  public lastInput: string | null = null;
  public error: Error | null = null;
  public vector: Float32Array = new Float32Array([0.1, 0.2, 0.3]);

  public embed(text: string): Promise<EmbeddingVector> {
    this.callCount += 1;
    this.lastInput = text;
    if (this.error !== null) return Promise.reject(this.error);
    return Promise.resolve(EmbeddingVector.create(this.vector));
  }
  public embedBatch(): Promise<readonly EmbeddingVector[]> {
    return Promise.resolve([]);
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────

const queueItem = (over: Partial<EmbeddingQueueItem>): EmbeddingQueueItem => ({
  id: over.id ?? "01952f3b-7d8c-7000-8000-q00000000001",
  workspaceId: over.workspaceId ?? makeWorkspaceId(),
  targetKind: over.targetKind ?? "decision",
  targetRowId:
    over.targetRowId ?? "01952f3b-7d8c-7000-8000-d00000000001",
  enqueuedAt: over.enqueuedAt ?? Timestamp.fromEpochMs(ANCHOR_TIME_MS),
  attempts: over.attempts ?? 0,
  lastError: over.lastError ?? null,
});

const projection = (
  kind: QueryKindValue,
  id: string,
  over: Partial<MemoryProjection> = {},
): MemoryProjection => ({
  kind,
  id,
  title: over.title ?? "title-text",
  preview: over.preview ?? "preview-text",
  tags: over.tags ?? Tags.empty(),
  confidence: over.confidence ?? Confidence.full(),
  useCount: over.useCount ?? UseCount.zero(),
  lastUsedAt: over.lastUsedAt ?? LastUsed.at(Timestamp.fromEpochMs(ANCHOR_TIME_MS)),
  createdAt: over.createdAt ?? Timestamp.fromEpochMs(ANCHOR_TIME_MS),
  severity: over.severity ?? null,
});

// ─── Setup ─────────────────────────────────────────────────────────────

let queue: StubQueue;
let projections: StubProjections;
let embedder: StubEmbedder;
let clock: FakeClock;
let useCase: EmbedAndPersistUseCase;

beforeEach(() => {
  queue = new StubQueue();
  projections = new StubProjections();
  embedder = new StubEmbedder();
  clock = new FakeClock({ initialMs: ANCHOR_TIME_MS });
  useCase = new EmbedAndPersistUseCase(
    queue,
    projections,
    embedder,
    clock,
    new SilentLogger(),
  );
});

const ID_DEC = "01952f3b-7d8c-7000-8000-d00000000001";
const Q_ID = "01952f3b-7d8c-7000-8000-q00000000001";

describe("EmbedAndPersistUseCase.drainBatch", () => {
  it("returns frozen empty result when the queue is empty", async () => {
    const result = await useCase.drainBatch({
      workspaceId: makeWorkspaceId(),
      batchSize: 10,
      backoffWindowMs: 30_000,
    });

    expect(result.processed.length).toBe(0);
    expect(result.failed.length).toBe(0);
    expect(result.permanentFailures.length).toBe(0);
    expect(Object.isFrozen(result)).toBe(true);
    expect(embedder.callCount).toBe(0);
  });

  it("embeds a queued item, persists its vector, and acknowledges the row", async () => {
    queue.items = [queueItem({ id: Q_ID, targetKind: "decision", targetRowId: ID_DEC })];
    projections.projections = [projection("decision", ID_DEC)];

    const result = await useCase.drainBatch({
      workspaceId: makeWorkspaceId(),
      batchSize: 10,
      backoffWindowMs: 30_000,
    });

    expect(result.processed).toEqual([Q_ID]);
    expect(result.failed.length).toBe(0);
    expect(embedder.callCount).toBe(1);
    expect(embedder.lastInput).toBe("title-text\npreview-text");

    // Persist before ack (correctness requirement of the use case docstring).
    const persistIdx = queue.ops.findIndex((o) => o.type === "persist");
    const ackIdx = queue.ops.findIndex((o) => o.type === "ack");
    expect(persistIdx).toBeGreaterThan(-1);
    expect(ackIdx).toBeGreaterThan(persistIdx);
  });

  it("acknowledges the row when the underlying projection has been pruned", async () => {
    queue.items = [queueItem({ id: Q_ID, targetRowId: ID_DEC })];
    // Empty projections → row pruned between enqueue and dequeue.
    projections.projections = [];

    const result = await useCase.drainBatch({
      workspaceId: makeWorkspaceId(),
      batchSize: 10,
      backoffWindowMs: 30_000,
    });

    expect(result.processed).toEqual([Q_ID]);
    expect(embedder.callCount).toBe(0);
    expect(queue.ops.some((o) => o.type === "ack")).toBe(true);
  });

  it("records failure and keeps the row on transient embedder errors", async () => {
    queue.items = [queueItem({ id: Q_ID, targetRowId: ID_DEC })];
    projections.projections = [projection("decision", ID_DEC)];
    embedder.error = new Error("ONNX timeout");

    const result = await useCase.drainBatch({
      workspaceId: makeWorkspaceId(),
      batchSize: 10,
      backoffWindowMs: 30_000,
    });

    expect(result.processed.length).toBe(0);
    expect(result.failed).toEqual([Q_ID]);
    expect(queue.ops.some((o) => o.type === "fail")).toBe(true);
    // The row is still in the queue (recordFailure increments attempts).
    expect(queue.items.length).toBe(1);
    expect(queue.items[0]?.attempts).toBe(1);
  });

  it("flags permanent failure at MAX_ATTEMPTS=5 and skips the embedder", async () => {
    queue.items = [queueItem({ id: Q_ID, attempts: 5 })];
    projections.projections = [projection("decision", ID_DEC)];

    const result = await useCase.drainBatch({
      workspaceId: makeWorkspaceId(),
      batchSize: 10,
      backoffWindowMs: 30_000,
    });

    expect(result.permanentFailures).toEqual([Q_ID]);
    expect(embedder.callCount).toBe(0);
    // Permanent failures are NOT acknowledged (audit sweep handles them).
    expect(queue.ops.some((o) => o.type === "ack")).toBe(false);
  });

  it("handles a mixed batch (success + transient failure + permanent failure)", async () => {
    const ID_OK = "01952f3b-7d8c-7000-8000-d00000000010";
    const ID_FAIL = "01952f3b-7d8c-7000-8000-d00000000011";
    const ID_PERM = "01952f3b-7d8c-7000-8000-d00000000012";
    const Q_OK = "01952f3b-7d8c-7000-8000-q0000000000a";
    const Q_FAIL = "01952f3b-7d8c-7000-8000-q0000000000b";
    const Q_PERM = "01952f3b-7d8c-7000-8000-q0000000000c";

    queue.items = [
      queueItem({ id: Q_OK, targetRowId: ID_OK, attempts: 0 }),
      queueItem({ id: Q_FAIL, targetRowId: ID_FAIL, attempts: 0 }),
      queueItem({ id: Q_PERM, targetRowId: ID_PERM, attempts: 5 }),
    ];
    projections.projections = [
      projection("decision", ID_OK),
      projection("decision", ID_FAIL),
      projection("decision", ID_PERM),
    ];

    let count = 0;
    const originalEmbed = embedder.embed.bind(embedder);
    embedder.embed = (text: string): Promise<EmbeddingVector> => {
      count += 1;
      if (count === 2) return Promise.reject(new Error("embed boom"));
      return originalEmbed(text);
    };

    const result = await useCase.drainBatch({
      workspaceId: makeWorkspaceId(),
      batchSize: 10,
      backoffWindowMs: 30_000,
    });

    expect(result.processed).toEqual([Q_OK]);
    expect(result.failed).toEqual([Q_FAIL]);
    expect(result.permanentFailures).toEqual([Q_PERM]);
  });

  it("uses the injected modelName in persistEmbedding payload", async () => {
    queue.items = [queueItem({ id: Q_ID, targetRowId: ID_DEC })];
    projections.projections = [projection("decision", ID_DEC)];

    const customUC = new EmbedAndPersistUseCase(
      queue,
      projections,
      embedder,
      clock,
      new SilentLogger(),
      "custom/model-name",
    );
    await customUC.drainBatch({
      workspaceId: makeWorkspaceId(),
      batchSize: 10,
      backoffWindowMs: 30_000,
    });

    const persistOp = queue.ops.find((o) => o.type === "persist");
    expect(persistOp).toBeDefined();
    const payload = persistOp?.payload as { modelName: string };
    expect(payload.modelName).toBe("custom/model-name");
  });

  it("computes availableAfter as now - backoffWindowMs", async () => {
    let captured: Timestamp | null = null;
    const originalDequeue = queue.dequeueBatch.bind(queue);
    queue.dequeueBatch = (input: {
      workspaceId: WorkspaceId;
      limit: number;
      availableAfter: Timestamp;
    }): Promise<readonly EmbeddingQueueItem[]> => {
      captured = input.availableAfter;
      return originalDequeue(input);
    };

    await useCase.drainBatch({
      workspaceId: makeWorkspaceId(),
      batchSize: 5,
      backoffWindowMs: 60_000,
    });

    expect(captured).not.toBeNull();
    expect(captured?.epochMs).toBe(ANCHOR_TIME_MS - 60_000);
  });

  it("respects the batchSize parameter as the dequeue limit", async () => {
    queue.items = Array.from({ length: 5 }, (_, i) =>
      queueItem({
        id: `01952f3b-7d8c-7000-8000-q0000000000${i + 1}`,
        targetRowId: `01952f3b-7d8c-7000-8000-d0000000000${i + 1}`,
      }),
    );
    projections.projections = queue.items.map((it) =>
      projection(it.targetKind, it.targetRowId),
    );

    const result = await useCase.drainBatch({
      workspaceId: makeWorkspaceId(),
      batchSize: 2,
      backoffWindowMs: 30_000,
    });

    expect(result.processed.length).toBe(2);
  });
});
