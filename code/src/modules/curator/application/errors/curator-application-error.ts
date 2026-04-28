/**
 * Concrete error raised by the curator's application layer.
 *
 * Mirrors the `MemoryDomainError` / `CuratorDomainError` discriminator
 * pattern: every application-level failure carries a stable
 * `code` (kebab-case identifier) so adapters route on it instead of
 * pattern-matching on the message.
 *
 * The base class is INTENTIONALLY NOT a `DomainError`: an "in-flight
 * curator run already exists" or "stale curator run recovered" is an
 * orchestration condition, not an invariant violation of any single
 * aggregate. Surfacing it as a `DomainError` would miscategorise it
 * for the JSON-RPC error mapper.
 *
 * Construction is via static factories (one per `code`) so callers
 * cannot drift the literal.
 */
export type CuratorApplicationErrorCode =
  | "curator.run-already-inflight"
  | "curator.run-not-found";

export class CuratorApplicationError extends Error {
  public readonly code: CuratorApplicationErrorCode;

  private constructor(
    code: CuratorApplicationErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = "CuratorApplicationError";
    this.code = code;
    if (cause !== undefined) {
      // Non-enumerable so JSON.stringify does not leak the underlying
      // exception (mirrors the pattern in `domain-error.ts` and
      // `infrastructure-error.ts`).
      Object.defineProperty(this, "cause", {
        value: cause,
        enumerable: false,
        writable: false,
        configurable: true,
      });
    }
  }

  /**
   * Raised when `RunCurator.run(...)` is called while a previous run
   * is still in flight (the partial index `idx_curator_runs_inflight`
   * has at least one matching row that is younger than
   * `STALE_RUN_THRESHOLD_MS`).
   */
  public static runAlreadyInflight(
    workspaceId: string,
    inflightRunId: string,
  ): CuratorApplicationError {
    return new CuratorApplicationError(
      "curator.run-already-inflight",
      `a curator run is already in flight for workspace ${workspaceId} (run ${inflightRunId}); refusing to start another`,
    );
  }

  /**
   * Raised by the orchestrator when a `runId` it expected to load
   * could not be found. Indicates either a programming bug (the
   * orchestrator persisted the run via a different connection) or a
   * concurrent wipe (`recall wipe`).
   */
  public static runNotFound(runId: string): CuratorApplicationError {
    return new CuratorApplicationError(
      "curator.run-not-found",
      `curator run ${runId} was not found`,
    );
  }
}
