/**
 * Wires the `mcp-server` module: the six MVP use cases plus the
 * JSON-RPC handler chain (`StdioJsonRpcServer` →
 * `JsonRpcHandler` → `ToolDispatcher` → `StaticToolRegistry`).
 *
 * The dispatcher receives concrete `*UseCase` instances; those use
 * cases inject the cross-module facades wired in
 * `composition/facades/mcp-server-facades.ts`.
 */

import type { Readable, Writable } from "node:stream";

import type { Clock } from "../../shared/application/ports/clock.port.ts";
import type { Logger } from "../../shared/application/ports/logger.port.ts";
import { CheckHealthUseCase } from "../../modules/mcp-server/application/use-cases/check-health.use-case.ts";
import { GetContextUseCase } from "../../modules/mcp-server/application/use-cases/get-context.use-case.ts";
import { InitWorkspaceUseCase } from "../../modules/mcp-server/application/use-cases/init-workspace.use-case.ts";
import { RecallMemoryUseCase } from "../../modules/mcp-server/application/use-cases/recall-memory.use-case.ts";
import { RememberUseCase } from "../../modules/mcp-server/application/use-cases/remember.use-case.ts";
import { TrackTaskUseCase } from "../../modules/mcp-server/application/use-cases/track-task.use-case.ts";
import type { CheckHealthFacade } from "../../modules/mcp-server/application/ports/out/check-health-facade.port.ts";
import type { GetContextFacade } from "../../modules/mcp-server/application/ports/out/get-context-facade.port.ts";
import type { InitializeWorkspaceFacade } from "../../modules/mcp-server/application/ports/out/initialize-workspace-facade.port.ts";
import type { RecallMemoryFacade } from "../../modules/mcp-server/application/ports/out/recall-memory-facade.port.ts";
import type { RememberFacade } from "../../modules/mcp-server/application/ports/out/remember-facade.port.ts";
import type { TrackTaskFacade } from "../../modules/mcp-server/application/ports/out/track-task-facade.port.ts";
import {
  ToolDispatcher,
  type ToolUseCases,
} from "../../modules/mcp-server/infrastructure/dispatch/tool-dispatcher.ts";
import { StaticToolRegistry } from "../../modules/mcp-server/infrastructure/registry/static-tool-registry.ts";
import {
  JsonRpcHandler,
  type ServerInfo,
} from "../../modules/mcp-server/infrastructure/transport/json-rpc-handler.ts";
import { StdioJsonRpcServer } from "../../modules/mcp-server/infrastructure/transport/stdio-json-rpc-server.ts";

/**
 * Bag of mcp-server-side artefacts the bootstrap entrypoint owns:
 *   - The use cases bound to facades.
 *   - The dispatcher and registry (boot-time singletons).
 *   - The JSON-RPC handler ready to be plugged into a transport.
 *   - The `StdioJsonRpcServer` factory function — the bootstrap
 *     instantiates it with the actual `process.stdin` /
 *     `process.stdout` once the runtime is ready.
 */
export interface McpServerWiring {
  readonly useCases: ToolUseCases;
  readonly registry: StaticToolRegistry;
  readonly dispatcher: ToolDispatcher;
  readonly handler: JsonRpcHandler;
  readonly buildStdioServer: (input: {
    readonly stdin: Readable;
    readonly stdout: Writable;
  }) => StdioJsonRpcServer;
}

export interface McpServerFacadesBag {
  readonly init: InitializeWorkspaceFacade;
  readonly context: GetContextFacade;
  readonly recall: RecallMemoryFacade;
  readonly remember: RememberFacade;
  readonly task: TrackTaskFacade;
  readonly health: CheckHealthFacade;
}

export interface McpServerWiringOptions {
  readonly logger: Logger;
  readonly clock: Clock;
  readonly facades: McpServerFacadesBag;
  readonly serverInfo: ServerInfo;
}

/**
 * Builds the mcp-server wiring. The caller registers the actual
 * `ToolRegistration`s on the returned `registry` (see
 * `composition/tools/tool-registry-bootstrap.ts`).
 */
export function buildMcpServerWiring(
  options: McpServerWiringOptions,
): McpServerWiring {
  const init = new InitWorkspaceUseCase(options.facades.init, options.logger);
  const context = new GetContextUseCase(
    options.facades.context,
    options.logger,
  );
  const recall = new RecallMemoryUseCase(
    options.facades.recall,
    options.logger,
  );
  const remember = new RememberUseCase(options.facades.remember, options.logger);
  const task = new TrackTaskUseCase(options.facades.task, options.logger);
  const health = new CheckHealthUseCase(options.facades.health, options.logger);

  const useCases: ToolUseCases = {
    init,
    context,
    recall,
    remember,
    task,
    health,
  };

  const registry = new StaticToolRegistry();
  const dispatcher = new ToolDispatcher(registry, useCases);
  const handler = new JsonRpcHandler(
    dispatcher,
    registry,
    options.serverInfo,
    options.clock,
    options.logger,
  );

  const buildStdioServer = (input: {
    readonly stdin: Readable;
    readonly stdout: Writable;
  }): StdioJsonRpcServer =>
    new StdioJsonRpcServer(handler, input.stdin, input.stdout, options.logger);

  return {
    useCases,
    registry,
    dispatcher,
    handler,
    buildStdioServer,
  };
}
