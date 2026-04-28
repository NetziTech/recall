import type { DomainEvent } from "../../../../shared/domain/types/domain-event.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import type { Tokens } from "../../../../shared/domain/value-objects/tokens.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { SessionId } from "../../../memory/domain/value-objects/session-id.ts";
import type { BundleId } from "../aggregates/bundle-id.ts";

/**
 * Fact: a `ContextBundle` was just assembled by the recall pipeline.
 *
 * Emitted exactly once per bundle, by `ContextBundle.assemble(...)`.
 * Subscribers (audit log, latency telemetry, debug tracer) react after
 * the bundle is handed to the JSON-RPC adapter.
 *
 * Carries only the bundle's identity and aggregate counters — NOT the
 * full layer payloads. Subscribers that need the payloads should
 * project them from the bundle reference (the application layer holds
 * the bundle in scope when emitting); copying them into the event
 * would double the heap footprint of every recall.
 *
 * Invariants:
 * - `bundleId` identifies the bundle freshly created.
 * - `workspaceId` is the parent workspace.
 * - `sessionId` is the session in scope (may be `null` when no
 *   session is active).
 * - `layersCount` is the number of layers actually assembled (>= 0;
 *   bundles with zero layers are unusual but legal — e.g. the
 *   workspace was just initialised and has nothing to surface).
 * - `totalTokens` is the cumulative token cost across all layers.
 * - `occurredAt` is the moment assembly completed.
 * - `eventName` is the stable
 *   `"retrieval.context-bundle-assembled"` identifier.
 */
export class ContextBundleAssembled implements DomainEvent {
  public readonly eventName = "retrieval.context-bundle-assembled" as const;
  public readonly occurredAt: Timestamp;
  public readonly bundleId: BundleId;
  public readonly workspaceId: WorkspaceId;
  public readonly sessionId: SessionId | null;
  public readonly layersCount: number;
  public readonly totalTokens: Tokens;

  public constructor(input: {
    bundleId: BundleId;
    workspaceId: WorkspaceId;
    sessionId: SessionId | null;
    layersCount: number;
    totalTokens: Tokens;
    occurredAt: Timestamp;
  }) {
    this.bundleId = input.bundleId;
    this.workspaceId = input.workspaceId;
    this.sessionId = input.sessionId;
    this.layersCount = input.layersCount;
    this.totalTokens = input.totalTokens;
    this.occurredAt = input.occurredAt;
  }
}
