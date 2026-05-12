import { McpServerInfrastructureError } from "./mcp-server-infrastructure-error.ts";

/**
 * Standard JSON-RPC 2.0 code for "Parse error" (§5.1).
 */
const PARSE_ERROR = -32700;

/**
 * Raised when the bytes received on the transport could not be
 * parsed as JSON.
 *
 * Per JSON-RPC 2.0 §5.1, the response envelope still carries
 * `id: null` (no correlation possible) and `code: -32700`. The
 * adapter constructs the response from this error's `jsonRpcCode`
 * field; downstream loggers see it through `instanceof
 * McpServerInfrastructureError`.
 *
 * Invariants:
 * - `code` is the stable identifier `mcp-server.parse-error`.
 * - `jsonRpcCode` is the JSON-RPC 2.0 standard `-32700`.
 */
export class ParseError extends McpServerInfrastructureError {
  public readonly code = "mcp-server.parse-error";
  public override readonly jsonRpcCode: number = PARSE_ERROR;

  public constructor(message: string, cause?: unknown) {
    super(message, cause);
  }
}
