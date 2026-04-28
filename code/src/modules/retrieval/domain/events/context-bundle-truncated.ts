import type { DomainEvent } from "../../../../shared/domain/types/domain-event.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { Tokens } from "../../../../shared/domain/value-objects/tokens.ts";
import type { BundleId } from "../aggregates/bundle-id.ts";
import type { ContextLayerKindValue } from "../value-objects/context-layer-kind.ts";

/**
 * Fact: a `ContextBundle` had to be truncated to fit the token budget.
 *
 * Emitted by `ContextBundle.truncate()` when the running token total
 * exceeds the cap. The event records *which* layers were dropped (or
 * shortened) so the audit log can explain why a particular kind of
 * memory did not surface in the bundle.
 *
 * Carries:
 * - `droppedLayers`: kinds of layers that were entirely removed because
 *   the budget did not allow even a single entry.
 * - `tokensReclaimed`: how many tokens the truncation freed.
 * - `tokensBefore` / `tokensAfter`: bookkeeping for the recall pipeline
 *   to assert post-truncation that `tokensAfter <= maxTokens`.
 *
 * Invariants:
 * - `bundleId` identifies the bundle that was truncated.
 * - `droppedLayers` is a frozen array of `ContextLayerKindValue`
 *   literals (the literal, not the VO, so the event is JSON-friendly
 *   for the audit serialiser).
 * - `tokensReclaimed`, `tokensBefore`, `tokensAfter` are `Tokens` VOs
 *   (already non-negative).
 * - `tokensAfter <= tokensBefore` and
 *   `tokensReclaimed === tokensBefore - tokensAfter`.
 * - `occurredAt` is the moment the truncation completed.
 * - `eventName` is the stable
 *   `"retrieval.context-bundle-truncated"` identifier.
 */
export class ContextBundleTruncated implements DomainEvent {
  public readonly eventName = "retrieval.context-bundle-truncated" as const;
  public readonly occurredAt: Timestamp;
  public readonly bundleId: BundleId;
  public readonly droppedLayers: readonly ContextLayerKindValue[];
  public readonly tokensReclaimed: Tokens;
  public readonly tokensBefore: Tokens;
  public readonly tokensAfter: Tokens;

  public constructor(input: {
    bundleId: BundleId;
    droppedLayers: readonly ContextLayerKindValue[];
    tokensReclaimed: Tokens;
    tokensBefore: Tokens;
    tokensAfter: Tokens;
    occurredAt: Timestamp;
  }) {
    this.bundleId = input.bundleId;
    this.droppedLayers = Object.freeze([...input.droppedLayers]);
    this.tokensReclaimed = input.tokensReclaimed;
    this.tokensBefore = input.tokensBefore;
    this.tokensAfter = input.tokensAfter;
    this.occurredAt = input.occurredAt;
  }
}
