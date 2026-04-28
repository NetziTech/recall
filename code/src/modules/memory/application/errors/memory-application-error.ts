/**
 * Concrete error raised by the memory module's application layer.
 *
 * Mirrors the `CuratorApplicationError` discriminator pattern: every
 * application-level failure carries a stable `code` (kebab-case
 * identifier) so adapters route on it instead of pattern-matching on
 * the message.
 *
 * The base class is INTENTIONALLY NOT a `DomainError`: a "no active
 * session" or "task not found" condition is a use-case orchestration
 * problem, not an invariant violation of any single aggregate. Surfacing
 * it as a `DomainError` would miscategorise it for the JSON-RPC error
 * mapper.
 *
 * Construction is via static factories (one per `code`) so callers
 * cannot drift the literal.
 */
export type MemoryApplicationErrorCode =
  | "memory.no-active-session"
  | "memory.session-not-found"
  | "memory.task-not-found"
  | "memory.entity-already-exists"
  | "memory.entity-not-found"
  | "memory.decision-not-found"
  | "memory.learning-not-found"
  | "memory.relation-endpoint-missing"
  | "memory.import-validation-failed"
  | "memory.handoff-parse-failed"
  | "memory.export-serialization-failed";

export class MemoryApplicationError extends Error {
  public readonly code: MemoryApplicationErrorCode;

  private constructor(
    code: MemoryApplicationErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = "MemoryApplicationError";
    this.code = code;
    if (cause !== undefined) {
      // Non-enumerable so JSON.stringify does not leak the underlying
      // exception (mirrors the pattern in `domain-error.ts`,
      // `infrastructure-error.ts`, and `curator-application-error.ts`).
      Object.defineProperty(this, "cause", {
        value: cause,
        enumerable: false,
        writable: false,
        configurable: true,
      });
    }
  }

  /**
   * Raised by use cases that require an active session
   * (`RecordTurnUseCase`, ...) when no open session exists for the
   * workspace and the implicit-session helper has not been wired in.
   */
  public static noActiveSession(workspaceId: string): MemoryApplicationError {
    return new MemoryApplicationError(
      "memory.no-active-session",
      `no active session for workspace ${workspaceId}; call StartSessionUseCase first`,
    );
  }

  public static sessionNotFound(sessionId: string): MemoryApplicationError {
    return new MemoryApplicationError(
      "memory.session-not-found",
      `session ${sessionId} was not found`,
    );
  }

  public static taskNotFound(taskId: string): MemoryApplicationError {
    return new MemoryApplicationError(
      "memory.task-not-found",
      `task ${taskId} was not found`,
    );
  }

  public static decisionNotFound(decisionId: string): MemoryApplicationError {
    return new MemoryApplicationError(
      "memory.decision-not-found",
      `decision ${decisionId} was not found`,
    );
  }

  public static learningNotFound(learningId: string): MemoryApplicationError {
    return new MemoryApplicationError(
      "memory.learning-not-found",
      `learning ${learningId} was not found`,
    );
  }

  public static entityAlreadyExists(
    name: string,
    kind: string,
  ): MemoryApplicationError {
    return new MemoryApplicationError(
      "memory.entity-already-exists",
      `entity (name="${name}", kind="${kind}") already exists in this workspace`,
    );
  }

  public static entityNotFound(entityId: string): MemoryApplicationError {
    return new MemoryApplicationError(
      "memory.entity-not-found",
      `entity ${entityId} was not found`,
    );
  }

  public static relationEndpointMissing(
    side: "from" | "to",
    endpointId: string,
  ): MemoryApplicationError {
    return new MemoryApplicationError(
      "memory.relation-endpoint-missing",
      `relation ${side} endpoint ${endpointId} does not exist`,
    );
  }

  public static importValidationFailed(
    detail: string,
    cause?: unknown,
  ): MemoryApplicationError {
    return new MemoryApplicationError(
      "memory.import-validation-failed",
      `memory import validation failed: ${detail}`,
      cause,
    );
  }

  public static handoffParseFailed(
    detail: string,
    cause?: unknown,
  ): MemoryApplicationError {
    return new MemoryApplicationError(
      "memory.handoff-parse-failed",
      `HANDOFF.md parse failed: ${detail}`,
      cause,
    );
  }

  public static exportSerializationFailed(
    detail: string,
    cause?: unknown,
  ): MemoryApplicationError {
    return new MemoryApplicationError(
      "memory.export-serialization-failed",
      `memory export serialization failed: ${detail}`,
      cause,
    );
  }
}
