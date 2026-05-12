import { McpServerDomainError } from "./mcp-server-domain-error.ts";

/**
 * Standard JSON-RPC 2.0 code for "invalid request" (§5.1).
 *
 * A bad request id is an *envelope-level* problem (the server cannot
 * even decide which response to correlate with), so the canonical wire
 * code is `-32600 INVALID_REQUEST` rather than the parameter-level
 * `-32602 INVALID_PARAMS`.
 */
const INVALID_REQUEST = -32600;

/**
 * Raised when a JSON-RPC request id is malformed: not a string, not a
 * number, an empty string after trimming, a non-finite number, or a
 * fractional number (the spec recommends against the last but does
 * not strictly forbid it; we forbid it deliberately to avoid the
 * floating-point equality footguns when echoing the id back to the
 * client).
 *
 * Note: per JSON-RPC 2.0 §4.1 a `null` id signals a *notification*
 * (no response expected). The MCP server treats notifications as a
 * separate flow and does NOT raise this error for them — `null` is
 * not "an invalid id", it is "not a request id at all".
 *
 * Invariants:
 * - `code` is the stable identifier `mcp-server.invalid-request-id`.
 * - `jsonRpcCode` is `-32600 INVALID_REQUEST`.
 */
export class InvalidRequestIdError extends McpServerDomainError {
  public readonly code = "mcp-server.invalid-request-id";
  public readonly jsonRpcCode: number | null = INVALID_REQUEST;

  public constructor(message: string, cause?: unknown) {
    super(
      message,
      cause,
    );
  }
}
