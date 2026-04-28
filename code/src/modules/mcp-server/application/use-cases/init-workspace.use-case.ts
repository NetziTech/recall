import type { Logger } from "../../../../shared/application/ports/logger.port.ts";
import type {
  InitInputWire,
  InitOutputWire,
} from "../dtos/wire-types.dto.ts";
import type { InitWorkspace } from "../ports/in/init-workspace.port.ts";
import type { InitializeWorkspaceFacade } from "../ports/out/initialize-workspace-facade.port.ts";

/**
 * Use case implementing the `mem.init` driving port.
 *
 * Architectural role (per the brief of Tarea 3.1):
 * - This use case is a **protocol facade**, not a business
 *   orchestrator. It owns:
 *   1. Logging the lifecycle of the call (`debug` on entry,
 *      `info` on success).
 *   2. Forwarding the validated wire DTO to the
 *      `InitializeWorkspaceFacade` output port.
 *   3. Letting typed errors propagate so the JSON-RPC adapter can
 *      map them to the correct wire-level code.
 *
 * It does NOT:
 * - Run business validation (the workspace use case it wraps does).
 * - Mutate any state directly (no aggregate is built here).
 * - Throw plain `Error` instances; every error here is either an
 *   `InfrastructureError` (transport-tier) or a `DomainError`
 *   (workspace-tier) that the wired facade has produced.
 *
 * Why a use case at all (instead of letting the JSON-RPC adapter
 * call the facade directly)?
 * - The `InitWorkspace` port is the formal seam between protocol
 *   transport and use-case orchestration. Future enhancements
 *   (request scoping, retry policy, request-level metrics) live in
 *   this layer naturally; the adapter stays a thin parser. The
 *   indirection costs one method call and is worth the clean DIP.
 */
export class InitWorkspaceUseCase implements InitWorkspace {
  public constructor(
    private readonly facade: InitializeWorkspaceFacade,
    private readonly logger: Logger,
  ) {}

  public async init(input: InitInputWire): Promise<InitOutputWire> {
    this.logger.debug({ tool: "mem.init" }, "tool invocation started");
    const output = await this.facade.initialize(input);
    this.logger.info(
      {
        tool: "mem.init",
        workspaceId: output.workspace_id,
        mode: output.mode,
        isNew: output.is_new,
      },
      "tool invocation completed",
    );
    return output;
  }
}
