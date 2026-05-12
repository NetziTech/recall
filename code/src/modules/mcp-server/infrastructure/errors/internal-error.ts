import { McpServerInfrastructureError } from "./mcp-server-infrastructure-error.ts";

/**
 * Standard JSON-RPC 2.0 code for "Internal error" (§5.1).
 */
const INTERNAL_ERROR = -32603;

/**
 * Raised when the transport layer catches an unexpected exception
 * that does not fit any of the more specific subclasses (e.g. an
 * adapter implementation throws a plain `Error` because of a bug, or
 * the runtime itself blows up during serialisation).
 *
 * Mapped onto `-32603 INTERNAL_ERROR`. The original error is
 * preserved on `cause` so loggers can surface it.
 *
 * Invariants:
 * - `code` is the stable identifier `mcp-server.internal-error`.
 * - `jsonRpcCode` is the JSON-RPC 2.0 standard `-32603`.
 */
export class InternalError extends McpServerInfrastructureError {
  public readonly code = "mcp-server.internal-error";
  public override readonly jsonRpcCode: number = INTERNAL_ERROR;

  public constructor(message: string, cause?: unknown) {
    super(message, cause);
  }
}
