import { McpServerInfrastructureError } from "./mcp-server-infrastructure-error.ts";

/**
 * Standard JSON-RPC 2.0 code for "Invalid Request" (§5.1).
 */
const INVALID_REQUEST = -32600;

/**
 * Raised when the JSON parsed successfully but the resulting object
 * is not a valid JSON-RPC 2.0 request envelope (missing `jsonrpc`,
 * missing `method`, malformed `id`, ...).
 *
 * Distinct from `ParseError` (the bytes were not JSON at all) and
 * from `InvalidParamsError` (the request envelope is fine but the
 * `params` payload doesn't match the tool schema). The transport
 * layer routes each tier to the matching standard JSON-RPC code.
 *
 * Invariants:
 * - `code` is the stable identifier `mcp-server.invalid-request`.
 * - `jsonRpcCode` is the JSON-RPC 2.0 standard `-32600`.
 */
export class InvalidRequestError extends McpServerInfrastructureError {
  public readonly code = "mcp-server.invalid-request";
  public override readonly jsonRpcCode: number = INVALID_REQUEST;

  public constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}
