import type { Logger } from "../../../../shared/application/ports/logger.port.ts";
import type {
  RecallInputWire,
  RecallOutputWire,
} from "../dtos/wire-types.dto.ts";
import type { RecallMemory } from "../ports/in/recall-memory.port.ts";
import type { RecallMemoryFacade } from "../ports/out/recall-memory-facade.port.ts";

/**
 * Use case implementing the `mem.recall` driving port.
 *
 * Forwards the validated wire DTO to the `RecallMemoryFacade` output
 * port. The most-frequent tool in the protocol; logging deliberately
 * keeps payload small to avoid log churn (no per-result fields).
 *
 * See `InitWorkspaceUseCase` for the architectural rationale that
 * applies to every protocol-facade use case in this module.
 */
export class RecallMemoryUseCase implements RecallMemory {
  public constructor(
    private readonly facade: RecallMemoryFacade,
    private readonly logger: Logger,
  ) {}

  public async recall(input: RecallInputWire): Promise<RecallOutputWire> {
    this.logger.debug({ tool: "mem.recall" }, "tool invocation started");
    const output = await this.facade.recall(input);
    this.logger.info(
      {
        tool: "mem.recall",
        results: output.results.length,
        totalCandidates: output.total_candidates,
        totalTokens: output.total_tokens,
        fallbackReason: output.fallback_reason ?? null,
      },
      "tool invocation completed",
    );
    return output;
  }
}
