import type { DomainEvent } from "../../../../shared/domain/types/domain-event.ts";
import type { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import { Tokens } from "../../../../shared/domain/value-objects/tokens.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { SessionId } from "../../../memory/domain/value-objects/session-id.ts";
import { LayerAlreadyPresentError } from "../errors/layer-already-present-error.ts";
import { ContextBundleAssembled } from "../events/context-bundle-assembled.ts";
import { ContextBundleTruncated } from "../events/context-bundle-truncated.ts";
import { ContextLayerAdded } from "../events/context-layer-added.ts";
import type { ContextLayer } from "../value-objects/context-layer.ts";
import {
  ContextLayerKind,
  type ContextLayerKindValue,
} from "../value-objects/context-layer-kind.ts";
import type { Query } from "../value-objects/query.ts";
import { TokenBudget } from "../value-objects/token-budget.ts";
import type { BundleId } from "./bundle-id.ts";

/**
 * Aggregate root for a context bundle — the result of the
 * `mem.context` tool described in `docs/02-protocolo-mcp.md` §4.2.
 *
 * The bundle is the product of the recall pipeline: it carries the
 * seven layers described in `docs/04-capas-contexto.md`, a token
 * budget, and the metadata that ties the bundle back to its workspace
 * and session. The aggregate's job is to enforce the budget invariant
 * and to record (via events) every meaningful step of the assembly so
 * the audit log can explain why the final bundle looks the way it does.
 *
 * Why this is an aggregate (not a VO) even though bundles are
 * ephemeral:
 * - The bundle has a stable identity (`BundleId`) that scopes the
 *   `ContextLayerAdded` and `ContextBundleTruncated` events. Without
 *   an id, subscribers could not correlate an `Added` and a
 *   `Truncated` event from the same assembly.
 * - The bundle exposes mutating operations (`addLayer`, `truncate`)
 *   with business-named verbs that enforce invariants. That is the
 *   aggregate-shaped contract.
 * - The events are the only side-channel by which the application
 *   layer (and the audit log) learns what happened during assembly;
 *   the aggregate's `pullEvents` drainage is the canonical pattern
 *   for that.
 *
 * The bundle is NOT persisted (the repositories interface omits a
 * bundle repository — see the module docstring of
 * `repositories/`). The aggregate id stays in scope only for the
 * duration of the JSON-RPC call that triggered it; the audit log
 * receives the events and forgets the rest.
 *
 * Invariants:
 * - The total tokens across all layers MUST never exceed
 *   `tokenBudget.maxTokens`. `addLayer(...)` refuses to append a layer
 *   that would breach the cap; `truncate()` is the only way to drop
 *   layers that no longer fit.
 * - Each kind of layer appears at most once. Adding a layer of a kind
 *   already present is rejected (the bundle is a flat list of seven
 *   slots, not a multimap).
 * - Layers are appended in arbitrary order, but the aggregate sorts
 *   them by `ContextLayerKind.priority()` when serialising via
 *   `getLayers()` so the consumer always sees the canonical order
 *   (workspace_anchor first, open_questions last).
 */
export class ContextBundle {
  private readonly id: BundleId;
  private readonly workspaceId: WorkspaceId;
  private readonly sessionId: SessionId | null;
  private readonly query: Query | null;
  private readonly layers: ContextLayer[];
  private tokenBudget: TokenBudget;
  private readonly assembledAt: Timestamp;
  private readonly events: DomainEvent[];

  private constructor(input: {
    id: BundleId;
    workspaceId: WorkspaceId;
    sessionId: SessionId | null;
    query: Query | null;
    layers: readonly ContextLayer[];
    tokenBudget: TokenBudget;
    assembledAt: Timestamp;
    events: readonly DomainEvent[];
  }) {
    this.id = input.id;
    this.workspaceId = input.workspaceId;
    this.sessionId = input.sessionId;
    this.query = input.query;
    this.layers = [...input.layers];
    this.tokenBudget = input.tokenBudget;
    this.assembledAt = input.assembledAt;
    this.events = [...input.events];
  }

  // -- factories -----------------------------------------------------------

  /**
   * Brings a fresh, empty `ContextBundle` into existence. The bundle
   * starts with no layers; the application layer feeds them via
   * `addLayer(...)`.
   *
   * Emits `ContextBundleAssembled` with `layersCount: 0` and
   * `totalTokens: 0`. The event name reads "assembled" rather than
   * "started" because the convention in this codebase is past-tense
   * (the bundle has been instantiated; further events report progress
   * inside the same assembly).
   */
  public static assemble(input: {
    id: BundleId;
    workspaceId: WorkspaceId;
    sessionId: SessionId | null;
    query: Query | null;
    tokenBudget: TokenBudget;
    occurredAt: Timestamp;
  }): ContextBundle {
    const event = new ContextBundleAssembled({
      bundleId: input.id,
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      layersCount: 0,
      totalTokens: Tokens.zero(),
      occurredAt: input.occurredAt,
    });
    return new ContextBundle({
      id: input.id,
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      query: input.query,
      layers: [],
      tokenBudget: input.tokenBudget,
      assembledAt: input.occurredAt,
      events: [event],
    });
  }

  /**
   * Rehydrates a bundle from previously-captured state. Does NOT emit
   * events. Used by the audit-log replay path (when the bundle is
   * reconstructed from its events for inspection).
   */
  public static rehydrate(input: {
    id: BundleId;
    workspaceId: WorkspaceId;
    sessionId: SessionId | null;
    query: Query | null;
    layers: readonly ContextLayer[];
    tokenBudget: TokenBudget;
    assembledAt: Timestamp;
  }): ContextBundle {
    return new ContextBundle({
      id: input.id,
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      query: input.query,
      layers: input.layers,
      tokenBudget: input.tokenBudget,
      assembledAt: input.assembledAt,
      events: [],
    });
  }

  // -- mutations -----------------------------------------------------------

  /**
   * Appends a layer to the bundle.
   *
   * Refuses:
   * - layers of a kind already present (raises
   *   `LayerAlreadyPresentError`);
   * - layers whose token cost would exceed the running budget (raises
   *   `TokenBudgetExceededError` from `TokenBudget.consume`).
   *
   * Emits `ContextLayerAdded` after the budget check passes.
   */
  public addLayer(input: {
    layer: ContextLayer;
    occurredAt: Timestamp;
  }): void {
    const layer = input.layer;
    const layerKind = layer.kindVO();
    if (this.hasLayerOfKind(layer.kind())) {
      throw new LayerAlreadyPresentError(layerKind.value);
    }
    // `consume` throws TokenBudgetExceededError if the cost would
    // breach the budget; the throw propagates up to the use case.
    this.tokenBudget = this.tokenBudget.consume(layer.tokens());
    this.layers.push(layer);
    this.events.push(
      new ContextLayerAdded({
        bundleId: this.id,
        layerKind,
        tokensConsumed: layer.tokens(),
        entriesCount: layer.entriesCount(),
        occurredAt: input.occurredAt,
      }),
    );
  }

  /**
   * Drops the lowest-priority layers (highest priority numbers) until
   * the bundle's token consumption fits the budget.
   *
   * In the steady state this is a no-op — the budget enforcement in
   * `addLayer` keeps the running total below the cap. The method
   * exists for the case where the budget was tightened *after* the
   * bundle was assembled (e.g. the caller initially asked for 7500
   * tokens and now wants to refit to 4400 — see
   * `docs/04-capas-contexto.md` §7 "Adaptaciones por tamaño").
   *
   * Emits `ContextBundleTruncated` exactly when at least one layer is
   * dropped. When no truncation is necessary, the method returns
   * silently and emits nothing.
   *
   * @param newMaxTokens - the new ceiling. MUST be positive.
   */
  public truncate(input: {
    newMaxTokens: number;
    occurredAt: Timestamp;
  }): void {
    const tokensBeforeNumber = this.tokenBudget.usedTokens;
    if (tokensBeforeNumber <= input.newMaxTokens) return;

    // Sort layer indices by priority DESC (lowest priority first) so we
    // drop the least-important layer first. Stable sort preserves
    // insertion order among ties (there are no ties — every kind is
    // unique — but the property is preserved for safety).
    const indicesByPriorityDesc = this.layers
      .map((layer, index) => ({ index, priority: layer.kindVO().priority() }))
      .sort((a, b) => b.priority - a.priority);

    const dropped: ContextLayerKindValue[] = [];
    const survivors = new Array<boolean>(this.layers.length).fill(true);
    let runningUsed = tokensBeforeNumber;

    for (const cursor of indicesByPriorityDesc) {
      if (runningUsed <= input.newMaxTokens) break;
      const droppedLayer = this.layers[cursor.index];
      if (droppedLayer === undefined) continue;
      survivors[cursor.index] = false;
      runningUsed -= droppedLayer.tokens().toNumber();
      dropped.push(droppedLayer.kind());
    }

    const survivingLayers: ContextLayer[] = [];
    for (let i = 0; i < this.layers.length; i += 1) {
      if (survivors[i] === true) {
        const survivor = this.layers[i];
        if (survivor === undefined) continue;
        survivingLayers.push(survivor);
      }
    }

    this.layers.length = 0;
    for (const survivor of survivingLayers) {
      this.layers.push(survivor);
    }
    const tokensAfter = Tokens.of(runningUsed);
    const tokensReclaimed = Tokens.of(tokensBeforeNumber - runningUsed);
    this.tokenBudget = TokenBudget.of({
      maxTokens: input.newMaxTokens,
      usedTokens: runningUsed,
    });
    this.events.push(
      new ContextBundleTruncated({
        bundleId: this.id,
        droppedLayers: dropped,
        tokensReclaimed,
        tokensBefore: Tokens.of(tokensBeforeNumber),
        tokensAfter,
        occurredAt: input.occurredAt,
      }),
    );
  }

  // -- queries -------------------------------------------------------------

  public getId(): BundleId {
    return this.id;
  }

  public getWorkspaceId(): WorkspaceId {
    return this.workspaceId;
  }

  public getSessionId(): SessionId | null {
    return this.sessionId;
  }

  public getQuery(): Query | null {
    return this.query;
  }

  public getTokenBudget(): TokenBudget {
    return this.tokenBudget;
  }

  public getAssembledAt(): Timestamp {
    return this.assembledAt;
  }

  /**
   * Returns the layers sorted by canonical priority (1 → 7). Callers
   * can rely on the ordering for serialisation without re-sorting.
   */
  public getLayers(): readonly ContextLayer[] {
    const sorted = [...this.layers].sort(
      (a, b) => a.kindVO().priority() - b.kindVO().priority(),
    );
    return Object.freeze(sorted);
  }

  public hasLayerOfKind(kind: ContextLayerKindValue): boolean {
    for (const layer of this.layers) {
      if (layer.kind() === kind) return true;
    }
    return false;
  }

  /**
   * Returns the layer of the given kind, or `null` when not present.
   */
  public findLayer(kind: ContextLayerKindValue): ContextLayer | null {
    for (const layer of this.layers) {
      if (layer.kind() === kind) return layer;
    }
    return null;
  }

  public layersCount(): number {
    return this.layers.length;
  }

  /**
   * Drains and returns the buffered events.
   */
  public pullEvents(): readonly DomainEvent[] {
    if (this.events.length === 0) return Object.freeze([]);
    const drained = this.events.slice();
    this.events.length = 0;
    return Object.freeze(drained);
  }
}

/**
 * Re-export the `ContextLayerKind` so consumers can build a layer kind
 * VO without a separate import path. Keeps the aggregate's "public"
 * surface coherent.
 */
export { ContextLayerKind };
