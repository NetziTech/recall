import { McpServerDomainError } from "./mcp-server-domain-error.ts";

/**
 * Standard JSON-RPC 2.0 code for "invalid request" (§5.1).
 *
 * The MCP `initialize` handshake rides on the JSON-RPC envelope, so a
 * malformed protocol version belongs to the *envelope* validation
 * tier, not to the *parameters of a method* tier. We therefore map
 * onto `-32600 INVALID_REQUEST` rather than `-32602 INVALID_PARAMS`.
 */
const INVALID_REQUEST = -32600;

/**
 * Raised when the protocol version received from a client (or read
 * from configuration) does not match the canonical `MAJOR.MINOR.PATCH`
 * shape the server understands.
 *
 * The factory `ProtocolVersion.create(...)` raises this error so the
 * transport layer can map it directly onto the standard JSON-RPC
 * `INVALID_REQUEST` code without re-inspecting the message.
 *
 * Invariants:
 * - `code` is the stable identifier `mcp-server.invalid-protocol-version`.
 * - `jsonRpcCode` is `-32600 INVALID_REQUEST`.
 */
export class InvalidProtocolVersionError extends McpServerDomainError {
  public readonly code = "mcp-server.invalid-protocol-version";
  public readonly jsonRpcCode: number | null = INVALID_REQUEST;

  public constructor(message: string, options?: { cause?: unknown }) {
    super(
      message,
      options !== undefined ? { cause: options.cause } : undefined,
    );
  }
}
