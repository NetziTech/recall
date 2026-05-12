import type { CuratorRunId } from "../value-objects/curator-run-id.ts";
import { CuratorDomainError } from "./curator-domain-error.ts";

/**
 * Raised when an operation tries to mutate a `CuratorRun` aggregate
 * that has already been marked complete.
 *
 * Once `complete(...)` is called the run is immutable: no further
 * findings, consolidations, or prunes may be appended. The aggregate
 * refuses any such attempt because:
 *
 * 1. The persisted `curator_runs` row already carries `endedAt` and
 *    the final stats; appending after persistence would silently lose
 *    the new entries.
 * 2. The run's downstream subscribers (logger, JSON-RPC response)
 *    have already drained the buffered events; mutations after
 *    completion would never reach them.
 *
 * Invariants:
 * - `code` is the stable identifier `curator.run-already-completed`.
 * - `runId` identifies the offending run.
 * - `jsonRpcCode` is `null` (this is an internal invariant; the
 *   application layer should never let this surface).
 */
export class CuratorRunAlreadyCompletedError extends CuratorDomainError {
  public readonly code = "curator.run-already-completed";
  public readonly jsonRpcCode: number | null = null;
  public readonly runId: CuratorRunId;

  public constructor(runId: CuratorRunId, cause?: unknown) {
    super(
      `curator run ${runId.toString()} has already been completed and cannot be mutated`,
      cause,
    );
    this.runId = runId;
  }
}
