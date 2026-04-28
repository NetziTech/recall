import type { DomainEvent } from "../../../../shared/domain/types/domain-event.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { Tokens } from "../../../../shared/domain/value-objects/tokens.ts";
import type { BundleId } from "../aggregates/bundle-id.ts";
import type { ContextLayerKind } from "../value-objects/context-layer-kind.ts";

/**
 * Fact: a layer was just appended to a `ContextBundle`.
 *
 * Emitted by `ContextBundle.addLayer(...)` after the budget check
 * passes and the layer is appended to the internal list. Subscribers
 * (per-layer telemetry, audit log) react after the bundle assembly
 * completes — this event by itself does not imply the bundle is
 * finished.
 *
 * Invariants:
 * - `bundleId` identifies the bundle the layer belongs to.
 * - `layerKind` is the kind of the layer added (one of the seven from
 *   `docs/04-capas-contexto.md` §2).
 * - `tokensConsumed` is the token cost of the layer (>= 0). The
 *   bundle's running budget is `previousUsed + tokensConsumed` after
 *   the event.
 * - `entriesCount` is the number of refs in the layer's payload (1 for
 *   the workspace anchor, length-of-array for the others).
 * - `occurredAt` is the moment the layer was appended.
 * - `eventName` is the stable
 *   `"retrieval.context-layer-added"` identifier.
 */
export class ContextLayerAdded implements DomainEvent {
  public readonly eventName = "retrieval.context-layer-added" as const;
  public readonly occurredAt: Timestamp;
  public readonly bundleId: BundleId;
  public readonly layerKind: ContextLayerKind;
  public readonly tokensConsumed: Tokens;
  public readonly entriesCount: number;

  public constructor(input: {
    bundleId: BundleId;
    layerKind: ContextLayerKind;
    tokensConsumed: Tokens;
    entriesCount: number;
    occurredAt: Timestamp;
  }) {
    this.bundleId = input.bundleId;
    this.layerKind = input.layerKind;
    this.tokensConsumed = input.tokensConsumed;
    this.entriesCount = input.entriesCount;
    this.occurredAt = input.occurredAt;
  }
}
