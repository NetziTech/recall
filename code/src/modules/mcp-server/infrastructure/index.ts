/**
 * Public surface of `modules/mcp-server/infrastructure/`.
 *
 * Re-exports the concrete adapters so the composition root can wire
 * them with their ports in one place. Mirrors the pattern adopted by
 * `shared/infrastructure/index.ts`,
 * `modules/encryption/infrastructure/index.ts` and
 * `modules/secrets/infrastructure/index.ts`.
 */

export { StaticToolRegistry } from "./registry/static-tool-registry.ts";

export {
  ToolDispatcher,
  type ToolDispatchResult,
  type ToolUseCases,
} from "./dispatch/tool-dispatcher.ts";
export {
  mapErrorToJsonRpc,
  type JsonRpcErrorPayload,
} from "./dispatch/error-mapper.ts";

export {
  JsonRpcHandler,
  type JsonRpcHandlerResult,
  type ServerInfo,
} from "./transport/json-rpc-handler.ts";
export {
  StdioJsonRpcServer,
  DEFAULT_MAX_BUFFER_BYTES,
  type StdioJsonRpcServerOptions,
} from "./transport/stdio-json-rpc-server.ts";
export {
  JSON_RPC_VERSION,
  isJsonRpcRequestShape,
  type JsonRpcErrorResponse,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type JsonRpcSuccessResponse,
} from "./transport/json-rpc-types.ts";

export {
  ContextInputSchema,
  HealthInputSchema,
  InitInputSchema,
  RecallInputSchema,
  RememberInputSchema,
  TaskInputSchema,
} from "./validation/index.ts";

export { McpServerInfrastructureError } from "./errors/mcp-server-infrastructure-error.ts";
export { ParseError } from "./errors/parse-error.ts";
export { InvalidRequestError } from "./errors/invalid-request-error.ts";
export {
  InvalidParamsError,
  type InvalidParamsIssue,
} from "./errors/invalid-params-error.ts";
export { InternalError } from "./errors/internal-error.ts";
export {
  BufferOverflowError,
  type BufferOverflowDetails,
} from "./errors/buffer-overflow-error.ts";
