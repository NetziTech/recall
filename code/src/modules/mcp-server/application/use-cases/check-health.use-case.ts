import type { Logger } from "../../../../shared/application/ports/logger.port.ts";
import type {
  HealthInputWire,
  HealthOutputWire,
} from "../dtos/wire-types.dto.ts";
import type { CheckHealth } from "../ports/in/check-health.port.ts";
import type { CheckHealthFacade } from "../ports/out/check-health-facade.port.ts";

/**
 * Use case implementing the `mem.health` driving port.
 *
 * Forwards the validated wire DTO to the `CheckHealthFacade` output
 * port. Logs a coarse summary so operators can correlate diagnostic
 * calls with subsequent operator action.
 */
export class CheckHealthUseCase implements CheckHealth {
  public constructor(
    private readonly facade: CheckHealthFacade,
    private readonly logger: Logger,
  ) {}

  public async health(input: HealthInputWire): Promise<HealthOutputWire> {
    this.logger.debug({ tool: "mem.health" }, "tool invocation started");
    const output = await this.facade.health(input);
    this.logger.info(
      {
        tool: "mem.health",
        workspaceId: output.workspace_id,
        mode: output.mode,
        encryptionStatus: output.encryption_status,
        totalEntries: output.total_entries,
        ftsHealth: output.fts_health,
        vectorIndexHealth: output.vector_index_health,
        warningCount: output.warnings?.length ?? 0,
      },
      "tool invocation completed",
    );
    return output;
  }
}
