import type { LearningId } from "../value-objects/learning-id.ts";
import { MemoryDomainError } from "./memory-domain-error.ts";

/**
 * Raised when the application layer attempts to consolidate a
 * `Learning` that has already been consolidated into another one.
 *
 * Per `docs/03-modelo-datos.md` §4.4, the `consolidated_into` column
 * is the audit trail for the curator's de-duplication pass: a learning
 * that has been folded into another one continues to exist (so old
 * pointers stay valid) but is excluded from active recall. A second
 * consolidation would either chain pointers (which the recall layer
 * does NOT follow) or overwrite the original target (losing history).
 * The aggregate refuses both.
 *
 * Invariants:
 * - `code` is the stable identifier `memory.learning-already-consolidated`.
 * - `learningId` identifies the offending learning.
 * - `jsonRpcCode` is `null`.
 */
export class LearningAlreadyConsolidatedError extends MemoryDomainError {
  public readonly code = "memory.learning-already-consolidated";
  public readonly jsonRpcCode: number | null = null;
  public readonly learningId: LearningId;

  public constructor(learningId: LearningId, options?: { cause?: unknown }) {
    super(
      `learning ${learningId.toString()} has already been consolidated and cannot be consolidated again`,
      options !== undefined ? { cause: options.cause } : undefined,
    );
    this.learningId = learningId;
  }
}
