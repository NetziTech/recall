import type { AffectedEntryRef } from "../value-objects/affected-entry-ref.ts";
import { CuratorDomainError } from "./curator-domain-error.ts";

/**
 * Raised when a `ConsolidationPair` factory receives inputs that
 * cannot form a meaningful consolidation:
 *
 * - `winner === loser`: the same entry is on both sides (the
 *   consolidation would be a no-op).
 * - `winner.kind !== loser.kind`: cross-kind consolidation is not
 *   supported (a `Decision` cannot be folded into a `Learning`, etc.;
 *   the curator's consolidation pass operates within one kind at a
 *   time per `docs/05-memoria-decay.md` §3).
 *
 * Invariants:
 * - `code` is the stable identifier `curator.invalid-consolidation-pair`.
 * - `winner` and `loser` are exposed so adapters can build precise
 *   diagnostics.
 * - `jsonRpcCode` is `null`: the failure is internal to the curator
 *   and never traverses the JSON-RPC boundary directly.
 */
export class InvalidConsolidationPairError extends CuratorDomainError {
  public readonly code = "curator.invalid-consolidation-pair";
  public readonly jsonRpcCode: number | null = null;
  public readonly winner: AffectedEntryRef;
  public readonly loser: AffectedEntryRef;

  public constructor(
    winner: AffectedEntryRef,
    loser: AffectedEntryRef,
    reason: string,
    options?: { cause?: unknown },
  ) {
    super(
      `invalid consolidation pair (winner=${winner.kind.toString()}/${winner.id}, loser=${loser.kind.toString()}/${loser.id}): ${reason}`,
      options !== undefined ? { cause: options.cause } : undefined,
    );
    this.winner = winner;
    this.loser = loser;
  }
}
