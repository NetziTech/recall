import { Id, type IdValue } from "../../../../shared/domain/value-objects/id.ts";

/**
 * Brand marker for tool-call identifiers. Lives at the type level only.
 */
export type ToolCallIdBrand = "tool-call";

/**
 * Identifier of a single tool invocation flowing through the MCP
 * server.
 *
 * A tool call is the unit that correlates a JSON-RPC request to its
 * eventual response. The MCP wire protocol uses the request `id`
 * (modelled separately as `RequestId` because it can be a string OR a
 * number per JSON-RPC 2.0 §4.2), but the domain also needs a *stable
 * server-side identity* for bookkeeping (tracing, audit log, future
 * metrics). `ToolCallId` is that identity.
 *
 * Contract:
 * - The value is a UUID v7 (per the rest of the codebase, see
 *   `docs/02-protocolo-mcp.md` §1 — "Identificadores: uuid v7").
 * - Generation happens via the shared `IdGenerator` port at the
 *   composition root; the domain only validates a string it receives.
 * - The brand prevents confusing tool-call ids with workspace ids,
 *   request ids, etc. at the type level.
 */
export class ToolCallId extends Id<ToolCallIdBrand> {
  /**
   * Builds a `ToolCallId` from a raw string. Validates UUID v7 shape
   * via the inherited `normalize` helper.
   */
  public static from(raw: string): ToolCallId {
    const normalised = Id.normalize(raw, "tool_call_id");
    return new ToolCallId(normalised as IdValue<ToolCallIdBrand>);
  }
}
