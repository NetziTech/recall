import type { ContextLayerKindValue } from "../value-objects/context-layer-kind.ts";
import { RetrievalDomainError } from "./retrieval-domain-error.ts";

/**
 * Raised when an attempt to add a layer of a kind already present in
 * the same `ContextBundle` is made.
 *
 * Bundles model the seven canonical layers (see
 * `docs/04-capas-contexto.md` §2) as a flat list of unique slots — one
 * `workspace_anchor`, one `active_decisions`, etc. Allowing duplicates
 * would force the consumer to merge them, which the doc explicitly
 * does not contemplate.
 *
 * Invariants:
 * - `code` is the stable identifier `retrieval.layer-already-present`.
 * - `layerKind` identifies the offending layer.
 * - `jsonRpcCode` is `null`: callers typically map this to
 *   `INVALID_PARAMS`.
 */
export class LayerAlreadyPresentError extends RetrievalDomainError {
  public readonly code = "retrieval.layer-already-present";
  public readonly jsonRpcCode: number | null = null;
  public readonly layerKind: ContextLayerKindValue;

  public constructor(layerKind: ContextLayerKindValue, cause?: unknown) {
    super(
      `bundle already contains a layer of kind "${layerKind}"`,
      cause,
    );
    this.layerKind = layerKind;
  }
}
