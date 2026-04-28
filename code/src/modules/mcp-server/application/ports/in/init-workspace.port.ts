import type {
  InitInputWire,
  InitOutputWire,
} from "../../dtos/wire-types.dto.ts";

/**
 * Driving (input) port for the `mem.init` tool.
 *
 * Implements the wire contract documented in
 * `docs/02-protocolo-mcp.md` §4.1: initialise or re-open a workspace,
 * idempotent. The protocol adapter (`StdioJsonRpcServer`) calls this
 * port after the JSON-RPC envelope and the per-tool input have both
 * been validated by Zod.
 *
 * Architectural role:
 * - This port is **the** boundary between the protocol layer and the
 *   workspace-domain logic. The use case implementing it
 *   (`InitWorkspaceUseCase`) is a thin protocol facade: it forwards
 *   the call to the `InitializeWorkspaceFacade` output port and maps
 *   typed domain errors to wire-level codes.
 * - The input/output DTOs intentionally use the wire literals from
 *   `application/dtos/wire-types.dto.ts` rather than the workspace
 *   module's value objects. The domain conversion is delegated to the
 *   composition root, which wires the workspace use case behind the
 *   facade port. That keeps `mcp-server` strictly modular per
 *   `docs/12-lineamientos-arquitectura.md` §1.5.
 *
 * Failure surface:
 * - Returns the success DTO on the happy path.
 * - Throws an `McpServerInfrastructureError` (or any subclass) on
 *   protocol-level failures; throws a `DomainError` (typed at the
 *   `WorkspaceDomain*` family on the wired side) on business
 *   failures. The adapter maps both via the dedicated error mapper.
 */
export interface InitWorkspace {
  init(input: InitInputWire): Promise<InitOutputWire>;
}
