import type { DomainEvent } from "../../../../shared/domain/types/domain-event.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { Tokens } from "../../../../shared/domain/value-objects/tokens.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { RecallFallbackReasonValue } from "../aggregates/recall-result.ts";

/**
 * Fact: a `mem.recall` operation just completed.
 *
 * Emitted by the application layer (NOT by the `RecallResult` VO,
 * which has no identity and does not buffer events). The event is
 * declared in the domain because the *fact* ("recall happened") is a
 * domain concept and the audit log subscriber needs the canonical
 * shape.
 *
 * Carries:
 * - `workspaceId`: the workspace that was queried.
 * - `queryText`: the raw query string when one was supplied, `null`
 *   when the recall was filter-only (the protocol allows omitting
 *   `query` — see `docs/02-protocolo-mcp.md` §4.3). The full `Query`
 *   VO is intentionally NOT carried: the audit log only needs the
 *   text, and the filters are summarised below.
 * - `entriesReturned`: how many entries the response contained
 *   (>= 0; capped by `top_k` / `RecallFilters.limit`).
 * - `totalCandidates`: how many entries matched the filters before the
 *   `top_k` slice (>= entriesReturned).
 * - `totalTokens`: cumulative token cost of the response.
 * - `fallbackReason`: when the recall pipeline degraded to FTS5 only
 *   (one of the literals in `recall-result.ts`); `null` otherwise.
 * - `durationMs`: wall-clock duration of the recall (provided by the
 *   application layer's stopwatch). The field exists here because the
 *   latency target (`docs/01-arquitectura.md` §10:
 *   `mem.recall < 100ms p95`) is a domain-level promise, and the
 *   audit log uses this number to track adherence.
 *
 * Invariants:
 * - `entriesReturned <= totalCandidates`.
 * - `durationMs >= 0`.
 * - `occurredAt` is the moment the recall completed.
 * - `eventName` is the stable `"retrieval.recall-executed"` identifier.
 */
export class RecallExecuted implements DomainEvent {
  public readonly eventName = "retrieval.recall-executed" as const;
  public readonly occurredAt: Timestamp;
  public readonly workspaceId: WorkspaceId;
  public readonly queryText: string | null;
  public readonly entriesReturned: number;
  public readonly totalCandidates: number;
  public readonly totalTokens: Tokens;
  public readonly fallbackReason: RecallFallbackReasonValue | null;
  public readonly durationMs: number;

  public constructor(input: {
    workspaceId: WorkspaceId;
    queryText: string | null;
    entriesReturned: number;
    totalCandidates: number;
    totalTokens: Tokens;
    fallbackReason: RecallFallbackReasonValue | null;
    durationMs: number;
    occurredAt: Timestamp;
  }) {
    this.workspaceId = input.workspaceId;
    this.queryText = input.queryText;
    this.entriesReturned = input.entriesReturned;
    this.totalCandidates = input.totalCandidates;
    this.totalTokens = input.totalTokens;
    this.fallbackReason = input.fallbackReason;
    this.durationMs = input.durationMs;
    this.occurredAt = input.occurredAt;
  }
}
