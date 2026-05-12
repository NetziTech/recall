import type { ToolName } from "../value-objects/tool-name.ts";
import { McpServerDomainError } from "./mcp-server-domain-error.ts";

/**
 * Standard JSON-RPC 2.0 code for "method not found" (§5.1).
 *
 * A *disabled* tool is reported using the same wire code as an unknown
 * tool: the protocol does not let us advertise "the method exists but
 * is currently disabled" without leaking server state. From the
 * client's point of view the tool is simply not callable, which is
 * exactly what `-32601 METHOD_NOT_FOUND` says.
 *
 * The domain still distinguishes the two cases (a `ToolDisabledError`
 * vs an `UnknownToolError`) so audit logs can tell them apart even
 * though the wire response is identical.
 */
const METHOD_NOT_FOUND = -32601;

/**
 * Raised when a JSON-RPC request targets a tool that is registered but
 * currently disabled (via `ToolRegistration.disable(...)`).
 *
 * Tools may be disabled for two reasons documented in
 * `docs/02-protocolo-mcp.md` (§4 covers the per-tool surface but not
 * the registration toggles — those live in this aggregate by design):
 * - The composition root opted out of a tool at startup (e.g. an
 *   experimental tool that ships behind a feature flag).
 * - An operator deliberately turned the tool off at runtime (CLI flow
 *   not yet exposed in the MVP).
 *
 * Invariants:
 * - `code` is the stable identifier `mcp-server.tool-disabled`.
 * - `toolName` is the offending registered name so the adapter can
 *   echo it (the audit log keeps the disabled-vs-unknown distinction
 *   even though the wire code collapses them).
 * - `jsonRpcCode` is `-32601 METHOD_NOT_FOUND` for the reason
 *   explained at the top of the file.
 */
export class ToolDisabledError extends McpServerDomainError {
  public readonly code = "mcp-server.tool-disabled";
  public readonly jsonRpcCode: number | null = METHOD_NOT_FOUND;
  public readonly toolName: ToolName;

  public constructor(toolName: ToolName, cause?: unknown) {
    super(
      `tool "${toolName.toString()}" is registered but currently disabled`,
      cause,
    );
    this.toolName = toolName;
  }
}
