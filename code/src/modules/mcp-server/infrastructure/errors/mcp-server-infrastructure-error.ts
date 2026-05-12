import { InfrastructureError } from "../../../../shared/infrastructure/errors/infrastructure-error.ts";

/**
 * Base class for every error raised inside
 * `modules/mcp-server/infrastructure/`.
 *
 * Why a dedicated subclass of `InfrastructureError`:
 * - Adapters in this module wrap the JSON-RPC stdio transport (parse
 *   errors, malformed envelopes, unknown methods, internal
 *   serialisation failures). The wrapped library is the
 *   `@modelcontextprotocol/sdk` client/server pair plus Node's stdio
 *   streams; both throw raw `Error` instances whose `message` is
 *   library-specific. Tagging every transport-tier error with a
 *   stable subclass lets the composition root route them on `code`
 *   without `instanceof XlibError` checks.
 * - Mirrors the pattern adopted by `EncryptionInfrastructureError`,
 *   `SecretsInfrastructureError`, `DatabaseError` and `EmbedderError`.
 *
 * Why these errors are THROWN (not returned via `Result`):
 * - The application port `Init/Recall/...` returns a plain `Promise`
 *   of the success DTO. Failure modes that are *recoverable at the
 *   business layer* are typed as `DomainError` subclasses (the
 *   `mcp-server` domain owns three: `UnknownToolError`,
 *   `ToolDisabledError`, `InvalidProtocolVersionError`) and travel
 *   via exceptions too — the JSON-RPC adapter is the single
 *   choke-point that converts them to error envelopes. Typing them
 *   in the result channel would force every use case to import the
 *   transport error class, which crosses the layering boundary
 *   (`docs/12 §1.1`: application MUST NOT import from
 *   infrastructure).
 *
 * Security invariants:
 * - Subclasses MUST NOT include raw client-supplied content (request
 *   payloads, header values, secret material the client may have
 *   inadvertently sent) in their `message`. Lengths and shape
 *   descriptors are public; payload bytes are not.
 * - `cause` (when set) preserves the original exception thrown by
 *   the wrapped library; downstream loggers redact via the standard
 *   `DEFAULT_REDACT_PATHS` mechanism in `PinoLogger`.
 *
 * Invariants:
 * - `code` is a stable kebab-case identifier scoped under the
 *   `mcp-server.` family (e.g. `mcp-server.parse-error`,
 *   `mcp-server.invalid-request`).
 */
export abstract class McpServerInfrastructureError extends InfrastructureError {
  /**
   * Canonical JSON-RPC numeric code for this error category. Concrete
   * subclasses MUST override with a `readonly` field initialiser. The
   * mapper reads this field to build the wire envelope without
   * `instanceof` ladders.
   */
  public abstract readonly jsonRpcCode: number;

  protected constructor(message: string, cause?: unknown) {
    super(
      message,
      cause,
    );
  }
}
