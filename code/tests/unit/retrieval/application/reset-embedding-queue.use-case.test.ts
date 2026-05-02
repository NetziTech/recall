import { beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_RESET_THRESHOLD,
  ResetEmbeddingQueueUseCase,
} from "../../../../src/modules/retrieval/application/use-cases/reset-embedding-queue.use-case.ts";
import type {
  EmbeddingQueueItem,
  EmbeddingQueueRepository,
} from "../../../../src/modules/retrieval/application/ports/out/embedding-queue-repository.port.ts";
import type { EmbeddingVector } from "../../../../src/modules/retrieval/domain/value-objects/embedding-vector.ts";
import type { QueryKindValue } from "../../../../src/modules/retrieval/domain/value-objects/query-kind.ts";
import type { Timestamp } from "../../../../src/shared/domain/value-objects/timestamp.ts";
import type { WorkspaceId } from "../../../../src/shared/domain/value-objects/workspace-id.ts";
import { makeWorkspaceId } from "../../../helpers/factories.ts";
import { SilentLogger } from "../../../helpers/test-doubles.ts";

class StubQueue implements EmbeddingQueueRepository {
  public lastResetInput: {
    workspaceId: WorkspaceId;
    attemptsAtLeast: number;
  } | null = null;
  public resetReturn = 0;

  public enqueue(): Promise<void> {
    return Promise.resolve();
  }
  public dequeueBatch(): Promise<readonly EmbeddingQueueItem[]> {
    return Promise.resolve([]);
  }
  public acknowledge(): Promise<void> {
    return Promise.resolve();
  }
  public recordFailure(): Promise<void> {
    return Promise.resolve();
  }
  public persistEmbedding(_input: {
    workspaceId: WorkspaceId;
    targetKind: QueryKindValue;
    targetRowId: string;
    embeddedText: string;
    modelName: string;
    vector: EmbeddingVector;
    persistedAt: Timestamp;
  }): Promise<void> {
    return Promise.resolve();
  }
  public countPending(): Promise<number> {
    return Promise.resolve(0);
  }
  public resetPermanentFailures(input: {
    workspaceId: WorkspaceId;
    attemptsAtLeast: number;
  }): Promise<number> {
    this.lastResetInput = input;
    return Promise.resolve(this.resetReturn);
  }
}

let queue: StubQueue;
let useCase: ResetEmbeddingQueueUseCase;

beforeEach(() => {
  queue = new StubQueue();
  useCase = new ResetEmbeddingQueueUseCase(queue, new SilentLogger());
});

describe("ResetEmbeddingQueueUseCase", () => {
  it("uses DEFAULT_RESET_THRESHOLD when caller omits attemptsAtLeast", async () => {
    queue.resetReturn = 7;
    const ws = makeWorkspaceId();

    const result = await useCase.execute({ workspaceId: ws });

    expect(result.attemptsAtLeast).toBe(DEFAULT_RESET_THRESHOLD);
    expect(result.attemptsAtLeast).toBe(5);
    expect(result.resetCount).toBe(7);
    expect(queue.lastResetInput?.attemptsAtLeast).toBe(5);
    expect(queue.lastResetInput?.workspaceId.toString()).toBe(ws.toString());
  });

  it("forwards a custom threshold to the repository", async () => {
    queue.resetReturn = 2;
    const ws = makeWorkspaceId();

    const result = await useCase.execute({
      workspaceId: ws,
      attemptsAtLeast: 3,
    });

    expect(result.attemptsAtLeast).toBe(3);
    expect(result.resetCount).toBe(2);
    expect(queue.lastResetInput?.attemptsAtLeast).toBe(3);
  });

  it("returns a frozen result object", async () => {
    const result = await useCase.execute({ workspaceId: makeWorkspaceId() });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("returns resetCount=0 when no rows met the threshold", async () => {
    queue.resetReturn = 0;
    const result = await useCase.execute({ workspaceId: makeWorkspaceId() });
    expect(result.resetCount).toBe(0);
  });
});
