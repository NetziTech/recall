import type {
  ContextInputWire,
  ContextOutputWire,
} from "../../dtos/wire-types.dto.ts";

/**
 * Driven (output) port: protocol-facing facade over the retrieval
 * module's `mem.context` use case.
 *
 * The composition root binds this facade to the retrieval module's
 * context-assembly path. The adapter is responsible for translating
 * between domain `ContextLayerKind` (domain-flavoured names) and the
 * wire `LayerNameWire` literals (transport-flavoured names). The
 * mapping is pinned in `application/dtos/wire-types.dto.ts` JSDoc
 * and tracked as decision pending in HANDOFF.md §6.5 D-102.
 *
 * Contract:
 * - Always returns a bundle (never throws on "no entries"). An empty
 *   bundle has `layers = []` and `total_tokens = 0`.
 * - When `query` is omitted, layers 5 (`relevant_memory`) and 6
 *   (`code_map`) MUST be omitted from the result (`docs/02 §4.2`).
 *   The wire format does not need a discriminator for that case;
 *   missing layers are simply absent from the array.
 */
export interface GetContextFacade {
  assemble(input: ContextInputWire): Promise<ContextOutputWire>;
}
