import { McpServerDomainError } from "./mcp-server-domain-error.ts";

/**
 * Standard JSON-RPC 2.0 code for "method not found" (§5.1).
 *
 * Defined inline here because the shared `JsonRpcErrorCodes` catalog
 * intentionally only enumerates the *project-specific* range
 * (-32100..-32109) — pulling the standard codes into that catalog
 * would muddle two distinct concerns. We keep the literal local to
 * the single error that needs it.
 */
const METHOD_NOT_FOUND = -32601;

/**
 * Raised when a JSON-RPC request targets a tool name that the registry
 * does not know about.
 *
 * Distinct from `InvalidInputError` produced by `ToolName.create(...)`
 * for malformed strings: this one is raised AFTER the wire format has
 * been accepted (`"mem.<verb>"` shape passes the regex / literal
 * check) but the registry has no `ToolRegistration` matching the
 * name. Modelling the two cases as separate errors lets the transport
 * layer route the "unknown method" failure to the canonical
 * `-32601 METHOD_NOT_FOUND` code while keeping malformed-name
 * failures as `INVALID_PARAMS`.
 *
 * Invariants:
 * - `code` is the stable identifier `mcp-server.unknown-tool`.
 * - `toolName` is the offending wire string so the adapter can echo
 *   it in `error.data.tool_name` (helpful for client-side debug
 *   logs).
 * - `jsonRpcCode` is the JSON-RPC 2.0 standard `-32601` code.
 */
export class UnknownToolError extends McpServerDomainError {
  public readonly code = "mcp-server.unknown-tool";
  public readonly jsonRpcCode: number | null = METHOD_NOT_FOUND;
  public readonly toolName: string;

  public constructor(toolName: string, cause?: unknown) {
    super(
      `tool "${toolName}" is not registered in the mcp-server registry`,
      cause,
    );
    this.toolName = toolName;
  }
}
