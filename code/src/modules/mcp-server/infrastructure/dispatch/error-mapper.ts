import { DomainError } from "../../../../shared/domain/errors/domain-error.ts";
import { JsonRpcErrorCodes } from "../../../../shared/domain/errors/json-rpc-error-codes.ts";
import { McpServerDomainError } from "../../domain/errors/mcp-server-domain-error.ts";
import { InvalidParamsError } from "../errors/invalid-params-error.ts";
import { McpServerInfrastructureError } from "../errors/mcp-server-infrastructure-error.ts";

/**
 * Maximum length of the `message` field in the wire error envelope.
 *
 * JSON-RPC 2.0 §5.1 does not impose a limit; we cap at 1024 chars
 * to keep error responses bounded and to ensure that runaway library
 * messages do not blow up the stdio frame size.
 */
const ERROR_MESSAGE_MAX_LENGTH = 1024;

/**
 * Default JSON-RPC code used when no more specific mapping applies.
 *
 * `-32603 INTERNAL_ERROR` is the catch-all per JSON-RPC 2.0 §5.1.
 * Reaching this branch indicates a bug — every error category we
 * surface should map to a typed code.
 */
const FALLBACK_INTERNAL_ERROR = -32603;

/**
 * Wire shape of a JSON-RPC error envelope (the `error` member of the
 * response). Mirrors §5.1: `{ code, message, data? }`.
 */
export interface JsonRpcErrorPayload {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

/**
 * Maps any error thrown during request handling onto the JSON-RPC
 * error envelope.
 *
 * Resolution order (first match wins):
 * 1. `McpServerInfrastructureError` — transport-tier failures
 *    (parse, invalid request, invalid params, internal). These
 *    carry a `jsonRpcCode` field directly.
 * 2. `McpServerDomainError` — protocol-tier domain failures
 *    (unknown tool, disabled tool, invalid protocol version, bad
 *    request id). These carry a `jsonRpcCode` field too.
 * 3. Any other `DomainError` — checked against the
 *    `JsonRpcErrorCodes` catalog (`docs/02 §6`) by inspecting
 *    `error.code`. Errors with no canonical mapping fall through to
 *    `INVALID_PARAMS` (-32602): the assumption is that anything the
 *    domain rejects at this point is a malformed input the client
 *    can fix. If a future domain error needs a different default it
 *    should advertise its `jsonRpcCode` directly (the
 *    `McpServerDomainError` pattern).
 * 4. Any other thrown value — wrapped as `INTERNAL_ERROR` (-32603).
 *    The `cause` is preserved on the resulting log line via the
 *    JSON-RPC adapter's logger; the wire envelope intentionally
 *    DOES NOT leak the cause to the client (security: avoid
 *    surfacing library internals).
 */
export function mapErrorToJsonRpc(error: unknown): JsonRpcErrorPayload {
  // Tier 1: transport-tier infrastructure errors.
  if (error instanceof InvalidParamsError) {
    return {
      code: error.jsonRpcCode,
      message: truncate(error.message),
      data: { issues: error.details },
    };
  }
  if (error instanceof McpServerInfrastructureError) {
    return {
      code: error.jsonRpcCode,
      message: truncate(error.message),
    };
  }

  // Tier 2: mcp-server domain errors (UnknownTool, ToolDisabled,
  // InvalidProtocolVersion, InvalidRequestId).
  if (error instanceof McpServerDomainError) {
    return {
      code: error.jsonRpcCode ?? FALLBACK_INTERNAL_ERROR,
      message: truncate(error.message),
    };
  }

  // Tier 3: foreign-domain errors that the protocol layer is
  // expected to map onto the `-32100..-32109` custom range.
  if (error instanceof DomainError) {
    const mapped = mapDomainCodeToJsonRpc(error.code);
    return {
      code: mapped,
      message: truncate(error.message),
    };
  }

  // Tier 3.5: foreign-application errors. Use cases throw structured
  // errors that intentionally extend `Error` (not `DomainError`) so
  // the categorisation is preserved (per
  // `memory-application-error.ts` and `curator-application-error.ts`
  // class JSDoc). The mapper still wants to translate their stable
  // `code` into a wire code instead of letting them fall through to
  // `INTERNAL_ERROR`. We duck-type on `error.code: string` to avoid
  // pulling cross-module imports into this layer.
  if (isCodedError(error)) {
    const mapped = mapDomainCodeToJsonRpc(error.code);
    return {
      code: mapped,
      message: truncate(error.message),
    };
  }

  // Tier 4: anything else. The wire envelope is intentionally
  // generic; the cause is left for the upstream logger to capture.
  return {
    code: FALLBACK_INTERNAL_ERROR,
    message: "internal error",
  };
}

/**
 * Type guard for `Error`-shaped values that carry a stable
 * `code: string` discriminator. Mirrors the
 * `MemoryApplicationError` / `CuratorApplicationError` shape without
 * importing those classes (cross-module rule, `docs/12 §1.5`).
 */
function isCodedError(error: unknown): error is Error & { code: string; message: string } {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && code.length > 0;
}

/**
 * Stable `error.code` → wire-code mapping for foreign-domain
 * errors. The implementation is intentionally exhaustive on the
 * known prefixes so adding a new domain error category that needs
 * a custom code is a one-line change here.
 *
 * See `docs/02-protocolo-mcp.md` §6 for the canonical catalog.
 */
function mapDomainCodeToJsonRpc(domainCode: string): number {
  switch (domainCode) {
    // Workspace-tier (the `workspace` module owns these codes).
    case "workspace.not-found":
      return JsonRpcErrorCodes.WORKSPACE_NOT_FOUND;
    case "workspace.session-expired":
      return JsonRpcErrorCodes.SESSION_EXPIRED;
    case "workspace.disk-full":
      return JsonRpcErrorCodes.DISK_FULL;
    case "workspace.schema-version-incompatible":
      return JsonRpcErrorCodes.SCHEMA_VERSION_INCOMPATIBLE;
    // Embedder-tier (retrieval module).
    case "retrieval.embedder-unavailable":
      return JsonRpcErrorCodes.EMBEDDING_SERVICE_UNAVAILABLE;
    // Curator-tier.
    case "curator.rate-limited":
      return JsonRpcErrorCodes.RATE_LIMITED;
    // Secrets-tier.
    case "secrets.detected":
      return JsonRpcErrorCodes.SECRET_DETECTED;
    // Encryption-tier.
    case "encryption.locked":
      return JsonRpcErrorCodes.ENCRYPTED_LOCKED;
    case "encryption.invalid-key":
      return JsonRpcErrorCodes.INVALID_KEY;
    case "encryption.key-revoked":
      return JsonRpcErrorCodes.KEY_REVOKED;
    // Memory-tier: task lookup failures surface a stable wire code
    // so MCP clients can recover (refresh their task list and retry)
    // without parsing free-form messages. See
    // `docs/02-protocolo-mcp.md` §6.
    case "memory.task-not-found":
      return JsonRpcErrorCodes.TASK_NOT_FOUND;
    default:
      // Anything unmapped is treated as a bad-input error rather
      // than a server failure: the domain rejected the call but
      // chose not to advertise a JSON-RPC code, which usually means
      // "the input was wrong but the protocol catalog hasn't grown
      // a slot for it yet".
      return -32602;
  }
}

function truncate(message: string): string {
  if (message.length <= ERROR_MESSAGE_MAX_LENGTH) return message;
  return `${message.slice(0, ERROR_MESSAGE_MAX_LENGTH - 1)}…`;
}
