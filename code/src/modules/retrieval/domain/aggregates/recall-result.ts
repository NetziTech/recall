import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { Tokens } from "../../../../shared/domain/value-objects/tokens.ts";
import type { Query } from "../value-objects/query.ts";
import type { RecallFilters } from "../value-objects/recall-filters.ts";
import type { RankedEntry } from "./ranked-entry.ts";

/**
 * Catalogue of legal `RecallFallbackReasonValue` values. Mirrors the
 * `fallback_reason` field on the `mem.recall` response
 * (`docs/02-protocolo-mcp.md` §4.3:
 * `"no_embeddings_yet" | "embedder_unavailable"`).
 *
 * The literal `null` (no fallback) is modelled at the wrapping field;
 * this catalogue only covers the named reasons.
 */
const RECALL_FALLBACK_REASONS = [
  "no_embeddings_yet",
  "embedder_unavailable",
] as const;

export type RecallFallbackReasonValue =
  (typeof RECALL_FALLBACK_REASONS)[number];

/**
 * Modelling decision — `RecallResult` as a VO, NOT an aggregate.
 *
 * The original task description left the call open ("VO o aggregate,
 * decisión libre, justificá"). The decision here is VO for three
 * reasons:
 *
 * 1. **No identity.** A recall result is a one-shot output of a query;
 *    callers do not "look it up later" and there is no `id` on the
 *    wire (`docs/02-protocolo-mcp.md` §4.3 — the response is a flat
 *    `{results, total_candidates, total_tokens, fallback_reason}`
 *    object). DDD reserves the aggregate label for things with stable
 *    identity that get loaded, mutated, saved.
 *
 * 2. **No mutations.** Once assembled, the result is read-only. There
 *    are no business operations on it (`markRead`, `narrow`, ...) —
 *    callers either serialise it or discard it.
 *
 * 3. **No persistence.** The repositories interface explicitly omits a
 *    `RecallResultRepository`. The audit log records that the recall
 *    happened (via the `RecallExecuted` event) but it does not store
 *    the full result.
 *
 * The VO lives under `aggregates/` rather than `value-objects/`
 * because it composes other aggregates' projections (`RankedEntry`)
 * and is logically the "output aggregate" of the recall pipeline. The
 * directory is a presentation choice, not a DDD-shape choice; the VO
 * has no identity and no mutations regardless of its location.
 *
 * Invariants:
 * - `entries` is a frozen array of `RankedEntry` projected at the
 *   moment of execution; the ordering is the score-descending ranking.
 * - `executedAt` is the moment the recall completed (provided by the
 *   `Clock` port at the application boundary).
 * - `query` is `null` when the caller invoked `mem.recall` without a
 *   `query` field (the protocol allows it — `docs/02-protocolo-mcp.md`
 *   §4.3 lists `query` as optional). When `null`, the result is a
 *   filter-only listing sorted by `order_by`; when non-null, the
 *   ranking includes the hybrid score components.
 * - `totalCandidates` is the size of the candidate set BEFORE the
 *   `top_k` slice (>= entries.length).
 * - `totalTokens` is the cumulative token cost of the rendered
 *   entries (matches the wire field `total_tokens`).
 * - `fallbackReason` is `null` unless the recall pipeline degraded to
 *   FTS5 only.
 *
 * Equality:
 * - Two `RecallResult` are equal iff every field matches structurally.
 *   In practice nobody compares them, but the contract is preserved
 *   for symmetry with the rest of the VO catalogue.
 */
export class RecallResult {
  private readonly entriesArr: readonly RankedEntry[];

  private constructor(
    public readonly query: Query | null,
    public readonly filters: RecallFilters,
    entries: readonly RankedEntry[],
    public readonly totalCandidates: number,
    public readonly totalTokens: Tokens,
    public readonly fallbackReason: RecallFallbackReasonValue | null,
    public readonly executedAt: Timestamp,
  ) {
    this.entriesArr = entries;
  }

  public static of(input: {
    query: Query | null;
    filters: RecallFilters;
    entries: readonly RankedEntry[];
    totalCandidates: number;
    totalTokens: Tokens;
    fallbackReason: RecallFallbackReasonValue | null;
    executedAt: Timestamp;
  }): RecallResult {
    if (!Number.isFinite(input.totalCandidates)) {
      throw new InvalidInputError(
        "totalCandidates must be a finite number",
        { field: "total_candidates" },
      );
    }
    if (!Number.isInteger(input.totalCandidates)) {
      throw new InvalidInputError("totalCandidates must be an integer", {
        field: "total_candidates",
      });
    }
    if (input.totalCandidates < 0) {
      throw new InvalidInputError(
        `totalCandidates must be non-negative (got: ${String(input.totalCandidates)})`,
        { field: "total_candidates" },
      );
    }
    if (input.entries.length > input.totalCandidates) {
      throw new InvalidInputError(
        `entries.length (${String(input.entries.length)}) cannot exceed totalCandidates (${String(input.totalCandidates)})`,
        { field: "entries" },
      );
    }
    if (
      input.fallbackReason !== null &&
      !RecallResult.isFallbackReason(input.fallbackReason)
    ) {
      throw new InvalidInputError(
        `fallbackReason must be one of ${RECALL_FALLBACK_REASONS.map((r) => `"${r}"`).join(" | ")} or null`,
        { field: "fallback_reason" },
      );
    }
    return new RecallResult(
      input.query,
      input.filters,
      Object.freeze([...input.entries]),
      input.totalCandidates,
      input.totalTokens,
      input.fallbackReason,
      input.executedAt,
    );
  }

  public static isFallbackReason(
    candidate: string,
  ): candidate is RecallFallbackReasonValue {
    for (const known of RECALL_FALLBACK_REASONS) {
      if (known === candidate) return true;
    }
    return false;
  }

  public getEntries(): readonly RankedEntry[] {
    return this.entriesArr;
  }

  public hasFallback(): boolean {
    return this.fallbackReason !== null;
  }

  public equals(other: RecallResult): boolean {
    if (this === other) return true;
    if (this.totalCandidates !== other.totalCandidates) return false;
    if (this.fallbackReason !== other.fallbackReason) return false;
    if (!this.totalTokens.equals(other.totalTokens)) return false;
    if (!this.executedAt.equals(other.executedAt)) return false;
    if (!this.filters.equals(other.filters)) return false;
    if (
      (this.query === null) !== (other.query === null) ||
      (this.query !== null &&
        other.query !== null &&
        !this.query.equals(other.query))
    ) {
      return false;
    }
    if (this.entriesArr.length !== other.entriesArr.length) return false;
    for (let i = 0; i < this.entriesArr.length; i += 1) {
      const a = this.entriesArr[i];
      const b = other.entriesArr[i];
      if (a === undefined || b === undefined) return false;
      if (!a.equals(b)) return false;
    }
    return true;
  }
}
