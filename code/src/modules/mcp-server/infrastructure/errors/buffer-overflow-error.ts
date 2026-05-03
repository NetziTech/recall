import { McpServerInfrastructureError } from "./mcp-server-infrastructure-error.ts";

/**
 * Reserved server-error code (JSON-RPC 2.0 §5.1, range
 * `-32099 .. -32000`). The wire spec does not define a standard
 * code for "request too large"; this falls into the
 * implementation-defined server-error band.
 *
 * The code surfaces in error logs (via the canonical
 * `jsonRpcCode` field on `McpServerInfrastructureError`) but does
 * NOT travel out as a wire response: a buffer overflow happens
 * BEFORE a complete frame has been parsed, so the transport has
 * nothing to correlate the error to. The policy is to close the
 * transport (see {@link BufferOverflowError} docstring).
 */
const SERVER_ERROR = -32000;

/**
 * Structured side-channel for the cap and the size at which the
 * cap was breached. Stored in {@link BufferOverflowError.details}
 * and NOT concatenated into the public `message` per
 * `W-3.5-SEC-L1`: numeric sizes are not sensitive themselves, but
 * pino's redactor walks structured keys and not message content,
 * so consistency keeps the redaction surface uniform across the
 * error hierarchy (matches `DatabaseError.details.sqlLength`).
 *
 * Invariants:
 * - `maxBufferBytes` is the configured cap (positive integer).
 * - `bufferedBytes` is the accumulator size at the moment the
 *   cap was breached (strictly greater than `maxBufferBytes`).
 *
 * `bytes` here means "UTF-16 code-unit count of the JavaScript
 * string accumulator". For ASCII input this equals the UTF-8
 * byte count; for non-ASCII it under-counts UTF-8 bytes, so the
 * effective protection is at least as tight as the configured
 * value when measured against an attacker streaming raw bytes.
 */
export interface BufferOverflowDetails {
  readonly maxBufferBytes: number;
  readonly bufferedBytes: number;
}

/**
 * Raised by {@link StdioJsonRpcServer} when the line-delimited
 * frame accumulator exceeds the configured cap WITHOUT a frame
 * delimiter (`\n`) being seen.
 *
 * Threat model (W-3.1-SEC-M1):
 * - An adversarial client streams bytes without ever emitting a
 *   newline. The accumulator grows without bound, the process's
 *   resident set climbs, and eventually the runtime is killed by
 *   the OS or thrashes — a classic memory-exhaustion DoS.
 * - The MVP shipping target (Claude Code as the only stdio peer)
 *   does NOT exercise this vector, but the cap is defense in
 *   depth: cheap to add, cheap to verify, and forward-compatible
 *   with multi-tenant or third-party MCP integrations.
 *
 * Policy on overflow:
 * - The transport is CLOSED. The `start()` promise rejects with
 *   this error. The buffer is dropped to free memory. The client
 *   must reconnect with a fresh stream.
 * - Discarding the buffer and continuing was rejected: the
 *   adversarial chunk likely contains the START of a legitimate
 *   frame whose tail would arrive on the next read, and silently
 *   discarding mid-frame would let later valid bytes parse as
 *   garbage (cascading parse-error frames) instead of failing
 *   loudly.
 *
 * Mapped onto the server-error band `-32000` (`SERVER_ERROR`).
 * The error never leaves the process as a wire response: by
 * construction the transport closes before another response is
 * written. The numeric code is recorded for log routing only.
 *
 * Invariants:
 * - `code` is the stable identifier
 *   `mcp-server.transport.buffer-overflow`.
 * - `jsonRpcCode` is `-32000` (reserved server-error band).
 * - `details` is populated and frozen at construction time.
 */
export class BufferOverflowError extends McpServerInfrastructureError {
  public readonly code = "mcp-server.transport.buffer-overflow";
  public override readonly jsonRpcCode: number = SERVER_ERROR;
  public readonly details: BufferOverflowDetails;

  public constructor(details: BufferOverflowDetails) {
    super(
      "stdio frame accumulator exceeded the configured cap without a delimiter; closing transport",
    );
    this.details = Object.freeze({
      maxBufferBytes: details.maxBufferBytes,
      bufferedBytes: details.bufferedBytes,
    });
  }
}
