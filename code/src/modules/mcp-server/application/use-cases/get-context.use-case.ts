import type { Logger } from "../../../../shared/application/ports/logger.port.ts";
import type {
  ContextInputWire,
  ContextOutputWire,
} from "../dtos/wire-types.dto.ts";
import type { GetContext } from "../ports/in/get-context.port.ts";
import type { GetContextFacade } from "../ports/out/get-context-facade.port.ts";

/**
 * Use case implementing the `mem.context` driving port.
 *
 * Forwards the validated wire DTO to the `GetContextFacade` output
 * port and logs the bundle size on the way back so operators can
 * correlate `total_tokens` to perceived assistant performance.
 *
 * See `InitWorkspaceUseCase` for the architectural rationale that
 * applies to every protocol-facade use case in this module.
 */
export class GetContextUseCase implements GetContext {
  public constructor(
    private readonly facade: GetContextFacade,
    private readonly logger: Logger,
  ) {}

  public async getContext(input: ContextInputWire): Promise<ContextOutputWire> {
    this.logger.debug({ tool: "mem.context" }, "tool invocation started");
    const output = await this.facade.assemble(input);
    this.logger.info(
      {
        tool: "mem.context",
        layers: output.bundle.layers.length,
        totalTokens: output.bundle.total_tokens,
      },
      "tool invocation completed",
    );
    return output;
  }
}
