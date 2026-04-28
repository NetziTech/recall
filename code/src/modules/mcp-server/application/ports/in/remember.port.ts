import type {
  RememberInputWire,
  RememberOutputWire,
} from "../../dtos/wire-types.dto.ts";

/**
 * Driving (input) port for the `mem.remember` tool.
 *
 * Implements the wire contract documented in
 * `docs/02-protocolo-mcp.md` §4.4: persists a memory entry whose
 * `kind` decides the table (decision, learning, entity or turn) and
 * which extra fields are honoured. The protocol adapter calls this
 * port after Zod validation; the use case behind it forwards to the
 * `RememberFacade` output port.
 *
 * Validation discipline:
 * - The Zod schema in `infrastructure/validation/` performs a
 *   *discriminator-aware* parse: required fields per `kind` are
 *   asserted before the use case is invoked. The use case itself
 *   does NOT re-validate; it trusts the boundary (the JSON-RPC
 *   adapter is the only entry point for tool calls).
 *
 * Failure surface:
 * - Capa 1/Capa 2 secret detection lives in the wired memory module
 *   and surfaces as a typed domain error mapped to wire code
 *   `-32105 SECRET_DETECTED` (`docs/02-protocolo-mcp.md` §6).
 * - Schema mismatches surface as `-32602 INVALID_PARAMS` from the
 *   Zod adapter, never from this port.
 */
export interface Remember {
  remember(input: RememberInputWire): Promise<RememberOutputWire>;
}
