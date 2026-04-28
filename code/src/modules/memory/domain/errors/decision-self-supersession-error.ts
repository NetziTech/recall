import type { DecisionId } from "../value-objects/decision-id.ts";
import { MemoryDomainError } from "./memory-domain-error.ts";

/**
 * Raised when a `Decision` is asked to supersede itself.
 *
 * The supersedes link is meant to record that a *different* decision
 * replaces the current one (`docs/03-modelo-datos.md` §4.3 — the
 * `superseded_by` column is filtered against `IS NULL` to skip the
 * decision from active recall). A self-loop would either trap recall
 * in an infinite chain or, more commonly, silently delete the entry
 * from active queries with no recoverable replacement. The aggregate
 * refuses the move so the caller has to provide the actual successor.
 *
 * Invariants:
 * - `code` is the stable identifier `memory.decision-self-supersession`.
 * - `decisionId` identifies the offending decision.
 * - `jsonRpcCode` is `null`.
 */
export class DecisionSelfSupersessionError extends MemoryDomainError {
  public readonly code = "memory.decision-self-supersession";
  public readonly jsonRpcCode: number | null = null;
  public readonly decisionId: DecisionId;

  public constructor(decisionId: DecisionId, options?: { cause?: unknown }) {
    super(
      `decision ${decisionId.toString()} cannot supersede itself`,
      options !== undefined ? { cause: options.cause } : undefined,
    );
    this.decisionId = decisionId;
  }
}
