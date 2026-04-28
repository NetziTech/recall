import type {
  ContextInputWire,
  ContextOutputWire,
} from "../../dtos/wire-types.dto.ts";

/**
 * Driving (input) port for the `mem.context` tool.
 *
 * Implements the wire contract documented in
 * `docs/02-protocolo-mcp.md` §4.2: returns the assembled bundle of
 * the seven context layers. The protocol adapter calls this port
 * after Zod validation; the use case behind it forwards to the
 * `GetContextFacade` output port and maps typed errors.
 *
 * Wire format:
 * - The output uses the `LayerNameWire` literals
 *   (`system_identity`, `project_constitution`, `code_map`, ...)
 *   that the protocol spec uses. The retrieval module's
 *   `ContextLayerKind` uses domain-flavoured names; the translation
 *   is performed by the `GetContextFacade` adapter wired in
 *   composition root (HANDOFF.md D-102, deferred to architect review
 *   in Fase 5).
 */
export interface GetContext {
  getContext(input: ContextInputWire): Promise<ContextOutputWire>;
}
