/**
 * Wire-shape types for the JSON-RPC 2.0 envelope, as documented in
 * the spec §4 (request) and §5 (response).
 *
 * The transport adapter validates incoming bytes against these
 * shapes; the dispatcher trusts them.
 */

/**
 * The protocol marker every JSON-RPC 2.0 message MUST carry.
 */
export const JSON_RPC_VERSION = "2.0";

/**
 * Shape of a JSON-RPC 2.0 request envelope. The `id` slot may be a
 * string, a number, or `null` for notifications (per §4.1).
 *
 * `params` is `unknown` because the per-tool Zod schema validates
 * it; declaring it `Record<string, unknown>` would force a
 * narrowing cast at every consumer.
 */
export interface JsonRpcRequest {
  readonly jsonrpc: typeof JSON_RPC_VERSION;
  readonly method: string;
  readonly params?: unknown;
  readonly id?: string | number | null;
}

/**
 * Shape of a JSON-RPC 2.0 success response envelope (§5).
 */
export interface JsonRpcSuccessResponse {
  readonly jsonrpc: typeof JSON_RPC_VERSION;
  readonly result: unknown;
  readonly id: string | number | null;
}

/**
 * Shape of a JSON-RPC 2.0 error response envelope (§5).
 */
export interface JsonRpcErrorResponse {
  readonly jsonrpc: typeof JSON_RPC_VERSION;
  readonly error: {
    readonly code: number;
    readonly message: string;
    readonly data?: unknown;
  };
  readonly id: string | number | null;
}

/**
 * Discriminated union for JSON-RPC responses.
 */
export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

/**
 * Type guard: a value plausibly looks like a JSON-RPC 2.0 envelope.
 *
 * The guard is *structural and conservative*: it returns `true` for
 * objects with `jsonrpc === "2.0"` and a string `method`. Adapters
 * that need a tighter check (e.g. `id` shape) should refine after
 * the guard.
 */
export function isJsonRpcRequestShape(value: unknown): value is JsonRpcRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (record["jsonrpc"] !== JSON_RPC_VERSION) return false;
  if (typeof record["method"] !== "string") return false;
  if (record["method"].length === 0) return false;
  return true;
}
