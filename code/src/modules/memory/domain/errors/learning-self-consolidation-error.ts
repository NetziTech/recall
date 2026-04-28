import type { LearningId } from "../value-objects/learning-id.ts";
import { MemoryDomainError } from "./memory-domain-error.ts";

/**
 * Raised when a `Learning` is asked to be consolidated into itself.
 *
 * Mirrors the rationale of `DecisionSelfSupersessionError`: a
 * self-pointer would either trap the curator in a loop while
 * collapsing duplicates or silently exclude the learning from active
 * recall with no real merge target. The aggregate refuses the move.
 *
 * Invariants:
 * - `code` is the stable identifier `memory.learning-self-consolidation`.
 * - `learningId` identifies the offending learning.
 * - `jsonRpcCode` is `null`.
 */
export class LearningSelfConsolidationError extends MemoryDomainError {
  public readonly code = "memory.learning-self-consolidation";
  public readonly jsonRpcCode: number | null = null;
  public readonly learningId: LearningId;

  public constructor(learningId: LearningId, options?: { cause?: unknown }) {
    super(
      `learning ${learningId.toString()} cannot be consolidated into itself`,
      options !== undefined ? { cause: options.cause } : undefined,
    );
    this.learningId = learningId;
  }
}
