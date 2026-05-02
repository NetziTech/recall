import type { Logger } from "../../../../shared/application/ports/logger.port.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { EmbeddingQueueRepository } from "../ports/out/embedding-queue-repository.port.ts";

/**
 * Default `attempts` threshold the use case treats as "permanent
 * failure". Mirrors `MAX_ATTEMPTS` in
 * {@link import("./embed-and-persist.use-case.ts").EmbedAndPersistUseCase}
 * so a row written off by the worker is the same row this use case
 * picks back up.
 */
export const DEFAULT_RESET_THRESHOLD = 5;

/**
 * Result of {@link ResetEmbeddingQueueUseCase.execute}.
 *
 * - `resetCount` — number of queue rows whose `attempts` was cleared.
 *   Surfaced to the CLI for human-readable confirmation.
 * - `attemptsAtLeast` — the threshold actually applied (echoes the
 *   input or the default).
 */
export interface ResetEmbeddingQueueResult {
  readonly resetCount: number;
  readonly attemptsAtLeast: number;
}

/**
 * Use case: clear the `attempts` counter on every embedding-queue row
 * that has reached or exceeded the permanent-failure threshold so the
 * worker re-tries them on the next drain.
 *
 * Recovery for B-MCP-7
 * ([issue #24](https://github.com/NetziTech/recall/issues/24)).
 *
 * Why this lives in the retrieval module:
 * - The embedding queue is owned by `retrieval/`. The CLI command
 *   (`recall reset-queue`) is a thin facade that calls this use case
 *   via the composition root, keeping the cross-module flow consistent
 *   with `curator-run`, `import-handoff`, etc.
 *
 * Operational contract:
 * - Idempotent: running the command twice on the same workspace is
 *   safe (the second run finds zero rows above threshold).
 * - The use case does NOT trigger a re-drain. The next iteration of
 *   the running {@link import("../../infrastructure/worker/async-embedding-worker.ts").AsyncEmbeddingWorker}
 *   picks the rows up on its normal poll cadence (within
 *   `idlePollMs + backoffWindowMs`).
 */
export class ResetEmbeddingQueueUseCase {
  public constructor(
    private readonly queue: EmbeddingQueueRepository,
    private readonly logger: Logger,
  ) {}

  public async execute(input: {
    workspaceId: WorkspaceId;
    attemptsAtLeast?: number;
  }): Promise<ResetEmbeddingQueueResult> {
    const threshold = input.attemptsAtLeast ?? DEFAULT_RESET_THRESHOLD;
    const resetCount = await this.queue.resetPermanentFailures({
      workspaceId: input.workspaceId,
      attemptsAtLeast: threshold,
    });
    this.logger.info(
      {
        workspaceId: input.workspaceId.toString(),
        attemptsAtLeast: threshold,
        resetCount,
      },
      "embedding queue permanent failures reset",
    );
    return Object.freeze({
      resetCount,
      attemptsAtLeast: threshold,
    });
  }
}
