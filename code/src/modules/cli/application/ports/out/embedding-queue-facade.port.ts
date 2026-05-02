/**
 * Driven (output) facade port for `recall reset-queue`.
 *
 * Maps the CLI invocation onto the retrieval module's
 * `ResetEmbeddingQueueUseCase`. The composition root provides the
 * concrete adapter; the CLI handler stays oblivious of the database
 * connection / container plumbing.
 *
 * B-MCP-7 ([issue #24](https://github.com/NetziTech/recall/issues/24)).
 */

export interface ResetQueueFacadeInput {
  readonly rootPath: string;
  /**
   * Minimum `attempts` value for a row to be reset. Defaults to 5
   * (the worker's `MAX_ATTEMPTS`) when `null`.
   */
  readonly threshold: number | null;
}

export interface ResetQueueFacadeOutput {
  readonly resetCount: number;
  readonly thresholdApplied: number;
}

export interface ResetQueueFacade {
  reset(input: ResetQueueFacadeInput): Promise<ResetQueueFacadeOutput>;
}
