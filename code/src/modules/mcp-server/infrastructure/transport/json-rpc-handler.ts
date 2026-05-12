import type { Clock } from "../../../../shared/application/ports/clock.port.ts";
import type { Logger } from "../../../../shared/application/ports/logger.port.ts";
import { RequestId } from "../../domain/value-objects/request-id.ts";
import type { ToolRegistry } from "../../domain/services/tool-registry.ts";
import type { ToolDispatcher } from "../dispatch/tool-dispatcher.ts";
import {
  mapErrorToJsonRpc,
  type JsonRpcErrorPayload,
} from "../dispatch/error-mapper.ts";
import { InvalidRequestError } from "../errors/invalid-request-error.ts";
import { McpServerInfrastructureError } from "../errors/mcp-server-infrastructure-error.ts";
import { ParseError } from "../errors/parse-error.ts";
import {
  isJsonRpcRequestShape,
  JSON_RPC_VERSION,
  type JsonRpcErrorResponse,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type JsonRpcSuccessResponse,
} from "./json-rpc-types.ts";

/**
 * Output of `JsonRpcHandler.handle(rawText)`.
 *
 * The wrapper makes notifications explicit: a successful
 * notification produces `{ kind: "no-response" }`, which the
 * stdio adapter interprets as "do not write anything to stdout".
 * Per JSON-RPC 2.0 §4.1, a notification (`id` absent) MUST NOT
 * receive a response.
 */
export type JsonRpcHandlerResult =
  | { readonly kind: "response"; readonly response: JsonRpcResponse }
  | { readonly kind: "no-response" };

/**
 * Bag of MCP-tier protocol metadata advertised during the
 * `initialize` handshake. Mirrors the fields the
 * `@modelcontextprotocol/sdk` would surface, but kept here as
 * inert data so the handler can be unit-tested without booting
 * the SDK.
 */
export interface ServerInfo {
  readonly name: string;
  readonly version: string;
  readonly protocolVersion: string;
}

/**
 * Transport-agnostic JSON-RPC handler.
 *
 * Responsibilities:
 * 1. Parse the raw text into a JSON value.
 * 2. Validate the JSON value as a JSON-RPC 2.0 envelope.
 * 3. Distinguish requests (`id` present) from notifications
 *    (`id` absent or `null`); notifications do not receive a
 *    response.
 * 4. Route the call:
 *    - `initialize` → returns the server info / capabilities.
 *    - `tools/list` → returns the catalogue from the registry.
 *    - `tools/call` → dispatches to the per-tool use case via
 *      `ToolDispatcher`.
 *    - Anything else → `-32601 METHOD_NOT_FOUND`.
 * 5. Wrap the response in a JSON-RPC 2.0 envelope (success or
 *    error) so the transport adapter can serialise it directly.
 *
 * Modes of failure → wire codes:
 *   - JSON parse error           → `-32700`
 *   - Envelope shape error       → `-32600`
 *   - Method routing miss        → `-32601`
 *   - Tool input validation      → `-32602`
 *   - Anything else from the use cases → mapped via
 *     `mapErrorToJsonRpc`.
 *
 * Concurrency:
 * - The handler is stateless. The stdio adapter reads frames
 *   sequentially; concurrent dispatch is the composition root's
 *   responsibility (and is not required by the MVP).
 */
export class JsonRpcHandler {
  public constructor(
    private readonly dispatcher: ToolDispatcher,
    private readonly registry: ToolRegistry,
    private readonly serverInfo: ServerInfo,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  public async handle(rawText: string): Promise<JsonRpcHandlerResult> {
    // 1. Parse JSON. Failure = `-32700` with `id: null`
    //    (impossible to correlate).
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch (cause) {
      const error = new ParseError("payload is not valid JSON", cause);
      this.logger.warn(
        { errorCode: error.code, jsonRpcCode: error.jsonRpcCode },
        "json-rpc parse failed",
      );
      return {
        kind: "response",
        response: this.buildErrorResponse(null, mapErrorToJsonRpc(error)),
      };
    }

    // 2. Validate envelope.
    if (!isJsonRpcRequestShape(parsed)) {
      const error = new InvalidRequestError(
        "payload is not a JSON-RPC 2.0 request envelope",
      );
      this.logger.warn(
        { errorCode: error.code, jsonRpcCode: error.jsonRpcCode },
        "json-rpc envelope invalid",
      );
      return {
        kind: "response",
        response: this.buildErrorResponse(null, mapErrorToJsonRpc(error)),
      };
    }

    // 3. Determine notification vs request.
    const idRaw = parsed.id ?? null;
    let requestId: RequestId | null = null;
    if (idRaw !== null) {
      try {
        requestId = RequestId.from(idRaw);
      } catch (cause) {
        // Bad id shape per JSON-RPC §4.1 → `-32600`.
        const error = new InvalidRequestError(
          "request id is not a valid JSON-RPC 2.0 id (string or integer number)",
          cause,
        );
        this.logger.warn(
          { errorCode: error.code, jsonRpcCode: error.jsonRpcCode },
          "json-rpc envelope id invalid",
        );
        return {
          kind: "response",
          response: this.buildErrorResponse(null, mapErrorToJsonRpc(error)),
        };
      }
    }

    // 4. Route on `method`.
    try {
      const result = await this.routeMethod(parsed);
      if (requestId === null) {
        return { kind: "no-response" };
      }
      return {
        kind: "response",
        response: this.buildSuccessResponse(requestId, result),
      };
    } catch (rawError) {
      // Convert anything thrown by the dispatcher / use cases
      // into the wire envelope. For notifications, swallow the
      // response per spec §4.1 but keep the log trail.
      const payload = mapErrorToJsonRpc(rawError);
      this.logger.warn(
        {
          method: parsed.method,
          jsonRpcCode: payload.code,
          errorMessage: payload.message,
        },
        "json-rpc method handler failed",
      );
      if (requestId === null) {
        return { kind: "no-response" };
      }
      return {
        kind: "response",
        response: this.buildErrorResponse(requestId, payload),
      };
    }
  }

  /**
   * Routes a validated JSON-RPC envelope to the matching MCP
   * method handler. Throws on unknown methods so the caller can
   * surface the failure as a JSON-RPC error response.
   */
  private async routeMethod(request: JsonRpcRequest): Promise<unknown> {
    const method = request.method;
    if (method === "initialize") {
      return this.handleInitialize();
    }
    if (method === "tools/list") {
      return this.handleToolsList();
    }
    if (method === "tools/call") {
      return this.handleToolsCall(request.params);
    }
    // Anything else → `-32601 METHOD_NOT_FOUND`. We surface this
    // via an `InvalidRequestError` subclass slot? No — JSON-RPC
    // distinguishes "envelope invalid" (-32600) from "method not
    // known" (-32601). Throw an `InternalError`-shaped wrapper
    // tagged for the mapper.
    throw new MethodNotFoundError(method);
  }

  private handleInitialize(): {
    readonly protocolVersion: string;
    readonly serverInfo: { readonly name: string; readonly version: string };
    readonly capabilities: { readonly tools: Readonly<Record<string, never>> };
  } {
    return {
      protocolVersion: this.serverInfo.protocolVersion,
      serverInfo: {
        name: this.serverInfo.name,
        version: this.serverInfo.version,
      },
      // The MVP advertises a non-empty capabilities object with
      // an empty `tools` slot; clients use the presence of the
      // key to detect tool support. The empty-record type
      // accurately captures the shape.
      capabilities: { tools: Object.freeze({}) },
    };
  }

  private handleToolsList(): {
    readonly tools: readonly {
      readonly name: string;
      readonly description: string;
    }[];
  } {
    const out: { readonly name: string; readonly description: string }[] = [];
    for (const reg of this.registry.listAll()) {
      if (reg.isDisabled()) continue;
      out.push({
        name: reg.getName().toString(),
        description: reg.getDescription().toString(),
      });
    }
    return { tools: Object.freeze(out) };
  }

  private async handleToolsCall(rawParams: unknown): Promise<unknown> {
    if (
      typeof rawParams !== "object" ||
      rawParams === null ||
      Array.isArray(rawParams)
    ) {
      throw new InvalidRequestError(
        'tools/call requires an object "params" with "name" and optional "arguments"',
      );
    }
    const params = rawParams as Record<string, unknown>;
    const nameValue = params["name"];
    if (typeof nameValue !== "string" || nameValue.length === 0) {
      throw new InvalidRequestError(
        'tools/call params must include a non-empty "name" string',
      );
    }
    // `arguments` is optional; default to an empty object so the
    // dispatcher always receives a value compatible with `unknown`
    // schemas.
    const args = "arguments" in params ? params["arguments"] : {};
    return this.dispatcher.dispatch(nameValue, args, this.clock.nowMs());
  }

  private buildSuccessResponse(
    id: RequestId,
    result: unknown,
  ): JsonRpcSuccessResponse {
    return {
      jsonrpc: JSON_RPC_VERSION,
      result,
      id: idToWire(id),
    };
  }

  private buildErrorResponse(
    id: RequestId | null,
    error: JsonRpcErrorPayload,
  ): JsonRpcErrorResponse {
    if (error.data === undefined) {
      return {
        jsonrpc: JSON_RPC_VERSION,
        error: {
          code: error.code,
          message: error.message,
        },
        id: id === null ? null : idToWire(id),
      };
    }
    return {
      jsonrpc: JSON_RPC_VERSION,
      error: {
        code: error.code,
        message: error.message,
        data: error.data,
      },
      id: id === null ? null : idToWire(id),
    };
  }
}

function idToWire(id: RequestId): string | number {
  const view = id.toValue();
  return view.value;
}

/**
 * Tagged subclass of `McpServerInfrastructureError` used when the
 * JSON-RPC method routing finds no handler for the given method.
 * Mapped to `-32601 METHOD_NOT_FOUND` by the error mapper via the
 * `jsonRpcCode` field (the `McpServerInfrastructureError` branch).
 *
 * Kept local to this file because no other adapter has the
 * vocabulary to throw it (and "unknown method" is distinct from
 * "unknown tool" — different wire entry points).
 */
class MethodNotFoundError extends McpServerInfrastructureError {
  public readonly code = "mcp-server.method-not-found";
  public override readonly jsonRpcCode: number = -32601;

  public constructor(method: string) {
    super(`json-rpc method "${method}" is not supported`);
  }
}
